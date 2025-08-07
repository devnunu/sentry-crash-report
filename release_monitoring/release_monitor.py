#!/usr/bin/env python3
"""
릴리즈 후 모니터링 알림 시스템 - 메인 스크립트
새로운 앱 버전 배포 후 크래시 및 중요 이슈 모니터링
"""

import argparse
import os
import sys
from datetime import datetime, timezone

from alert_sender import (
    send_critical_alert, send_summary_report, send_error_alert
)
# 설정 및 모듈 import
from config import (
    load_environment, validate_configuration, print_configuration,
    get_input_value, TEST_MODE, is_local_environment, KST
)
from monitoring_state import (
    get_active_monitoring_releases, add_monitoring_release,
    get_monitoring_phase, should_monitor_now, cleanup_completed_releases,
    print_monitoring_status
)
from release_analyzer import (
    test_sentry_connection, analyze_release_impact
)


def is_manual_trigger() -> bool:
    """수동 실행인지 확인 (GitHub Actions input 또는 CLI 인자)"""
    return bool(get_input_value('release_version'))


def get_release_start_time() -> datetime:
    """릴리즈 시작 시간 결정 (한국 시간 기준 입력 → UTC 저장)"""
    input_time = get_input_value('release_start_time', '').strip()

    if input_time:
        try:
            # 다양한 형식 지원 (모두 한국 시간으로 간주)
            for fmt in ['%Y-%m-%d %H:%M', '%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S']:
                try:
                    # 한국 시간으로 파싱
                    parsed_time = datetime.strptime(input_time, fmt)
                    kst_time = parsed_time.replace(tzinfo=KST)

                    print(f"✅ 사용자 지정 릴리즈 시간 (KST): {kst_time}")
                    print(f"   UTC 변환: {kst_time.astimezone(timezone.utc)}")

                    # UTC로 변환해서 반환
                    return kst_time.astimezone(timezone.utc)
                except ValueError:
                    continue

            print(f"⚠️ 잘못된 시간 형식: {input_time}")
            print("   지원 형식: YYYY-MM-DD HH:MM (한국 시간 기준)")

        except Exception as e:
            print(f"⚠️ 시간 파싱 오류: {e}")

    # 기본값: 현재 시간 (UTC)
    current_time = datetime.now(timezone.utc)
    current_kst = current_time.astimezone(KST)

    print(f"✅ 현재 시간 사용:")
    print(f"   KST: {current_kst}")
    print(f"   UTC: {current_time}")

    return current_time


def handle_manual_trigger():
    """수동 실행 처리 (새 릴리즈 모니터링 시작)"""
    print("🚀 새 릴리즈 모니터링을 시작합니다...")

    try:
        # 릴리즈 정보 수집
        release_version = get_input_value('release_version')
        release_start_time = get_release_start_time()
        monitoring_duration = int(get_input_value('monitoring_duration', '168'))

        if not release_version:
            raise ValueError("릴리즈 버전이 지정되지 않았습니다.")

        # 릴리즈 데이터 생성
        release_data = {
            'version': release_version,
            'start_time': release_start_time.isoformat(),
            'duration_hours': monitoring_duration,
            'environment': os.getenv('SENTRY_ENVIRONMENT', 'Production'),
            'created_at': datetime.now(timezone.utc).isoformat(),
            'created_by': 'manual_trigger'
        }

        print(f"📝 릴리즈 정보:")
        print(f"   - 버전: {release_version}")
        print(f"   - 시작: {release_start_time}")
        print(f"   - 기간: {monitoring_duration}시간")

        # 모니터링 상태에 추가
        if add_monitoring_release(release_data):
            print(f"✅ 릴리즈 {release_version} 모니터링이 시작되었습니다.")

            # 첫 번째 분석 수행
            print(f"\n📊 첫 번째 분석을 수행합니다...")
            analysis_result = analyze_release_impact(release_data)

            # 결과에 따른 알림 전송
            risk_level = analysis_result['risk_assessment']['level']

            if risk_level >= 4:
                print(f"🚨 Critical 알림 전송 (Level {risk_level})")
                send_critical_alert(analysis_result)
            else:
                print(f"📊 요약 리포트 전송 (Level {risk_level})")
                send_summary_report(analysis_result)

        else:
            print(f"❌ 릴리즈 추가에 실패했습니다.")

    except Exception as e:
        error_context = {
            'action': 'manual_trigger',
            'release_version': get_input_value('release_version', 'unknown')
        }
        print(f"❌ 수동 실행 처리 오류: {e}")
        send_error_alert(str(e), error_context)
        sys.exit(1)


def handle_automatic_trigger():
    """자동 실행 처리 (cron에 의한 기존 릴리즈 모니터링)"""
    print("⏰ 자동 모니터링 실행...")

    try:
        # 1. 빠른 체크 (1-2초 내 종료 가능)
        active_releases = get_active_monitoring_releases()

        if not active_releases:
            print("📝 모니터링 중인 릴리즈가 없습니다. 종료합니다.")
            return

        print(f"🔍 {len(active_releases)}개 릴리즈 모니터링 중...")

        # 2. 각 릴리즈별 모니터링 수행
        monitored_count = 0

        for release in active_releases:
            version = release.get('version', 'unknown')
            phase = get_monitoring_phase(release)

            print(f"\n📱 릴리즈 {version} ({phase} 단계)")

            if phase == 'scheduled':
                print("   ⏳ 아직 모니터링 시작 전입니다")
                continue
            elif phase == 'completed':
                print("   ✅ 모니터링 기간이 완료되었습니다")
                continue
            elif phase == 'invalid':
                print("   ❌ 잘못된 릴리즈 데이터입니다")
                continue

            # 실제 모니터링 수행 여부 결정
            if should_monitor_now(release, phase):
                print(f"   🔄 모니터링 실행...")

                try:
                    # 릴리즈 분석 수행
                    analysis_result = analyze_release_impact(release)
                    risk_level = analysis_result['risk_assessment']['level']

                    # 위험도에 따른 알림 전송
                    if risk_level >= 4:
                        print(f"   🚨 Critical 알림 전송 (Level {risk_level})")
                        send_critical_alert(analysis_result)
                    elif phase == 'intensive' or datetime.now().hour % 6 == 0:
                        # 집중 모니터링이거나 6시간마다 요약 리포트
                        print(f"   📊 요약 리포트 전송 (Level {risk_level})")
                        send_summary_report(analysis_result)
                    else:
                        print(f"   ✅ 정상 상태 (Level {risk_level}) - 알림 스킵")

                    monitored_count += 1

                except Exception as e:
                    print(f"   ❌ 모니터링 오류: {e}")
                    error_context = {
                        'action': 'monitor_release',
                        'release_version': version,
                        'phase': phase
                    }
                    send_error_alert(f"릴리즈 {version} 모니터링 오류: {str(e)}", error_context)
            else:
                reason = "정시가 아님" if phase == 'normal' else "스케줄에 맞지 않음"
                print(f"   ⏭️  스킵 ({reason})")

        # 3. 완료된 릴리즈 정리
        completed_count = cleanup_completed_releases()

        if completed_count > 0:
            print(f"\n🎉 {completed_count}개 릴리즈 모니터링이 완료되었습니다.")

        print(f"\n✅ 자동 모니터링 완료:")
        print(f"   - 분석된 릴리즈: {monitored_count}개")
        print(f"   - 정리된 릴리즈: {completed_count}개")
        print(f"   - 활성 릴리즈: {len(active_releases) - completed_count}개")

    except Exception as e:
        error_context = {
            'action': 'automatic_trigger',
            'active_releases': len(get_active_monitoring_releases())
        }
        print(f"❌ 자동 실행 처리 오류: {e}")
        send_error_alert(str(e), error_context)
        sys.exit(1)


def setup_local_cli():
    """로컬 CLI 인자 처리"""
    parser = argparse.ArgumentParser(description='릴리즈 모니터링 시스템')
    parser.add_argument('--version', help='릴리즈 버전')
    parser.add_argument('--start-time', help='릴리즈 시작 시간 (YYYY-MM-DD HH:MM)')
    parser.add_argument('--duration', type=int, default=168, help='모니터링 기간 (시간)')
    parser.add_argument('--test-mode', action='store_true', help='테스트 모드 활성화')
    parser.add_argument('--status', action='store_true', help='현재 모니터링 상태 확인')
    parser.add_argument('--cleanup', action='store_true', help='완료된 릴리즈 정리')

    args = parser.parse_args()

    # CLI 인자를 환경변수로 설정
    if args.version:
        os.environ['TEST_RELEASE_VERSION'] = args.version
    if args.start_time:
        os.environ['TEST_RELEASE_START_TIME'] = args.start_time
    if args.duration:
        os.environ['TEST_MONITORING_DURATION'] = str(args.duration)
    if args.test_mode:
        os.environ['TEST_MODE'] = 'true'

    return args


def main():
    """메인 함수"""
    # CLI에서 직접 실행될 때만 argparse 처리
    if len(sys.argv) > 1 and '--help' not in sys.argv and '-h' not in sys.argv:
        # 로컬 환경에서 CLI 인자 처리
        if is_local_environment():
            args = setup_local_cli()

            # 상태 확인만 수행
            if args and hasattr(args, 'status') and args.status:
                print_monitoring_status()
                return

            # 정리 작업만 수행
            if args and hasattr(args, 'cleanup') and args.cleanup:
                cleaned = cleanup_completed_releases()
                print(f"✅ {cleaned}개 릴리즈가 정리되었습니다.")
                return

    try:
        # 환경 설정 로드
        load_environment()

        # 실행 환경 정보 출력
        if is_local_environment():
            print("🏠 로컬 환경에서 실행 중")
        else:
            print("☁️ GitHub Actions 환경에서 실행 중")

        if TEST_MODE:
            print("🧪 테스트 모드 활성화")

        # 설정 검증
        if not validate_configuration():
            print("❌ 설정 검증 실패")
            sys.exit(1)

        # 설정 정보 출력
        print_configuration()

        # Sentry 연결 테스트 (로컬 환경에서만)
        if is_local_environment():
            print("\n🔍 Sentry 연결 테스트...")
            if not test_sentry_connection():
                print("❌ Sentry 연결 실패")
                sys.exit(1)

        # 실행 모드 결정 및 처리
        if is_manual_trigger():
            print("\n📝 수동 실행 모드 (새 릴리즈)")
            handle_manual_trigger()
        else:
            print("\n⏰ 자동 실행 모드 (기존 모니터링)")
            handle_automatic_trigger()

        print("\n🎉 릴리즈 모니터링 완료!")

    except KeyboardInterrupt:
        print("\n⚠️ 사용자에 의해 중단되었습니다.")
        sys.exit(0)
    except Exception as e:
        print(f"\n💥 예상치 못한 오류: {str(e)}")

        if TEST_MODE:
            import traceback
            print("\n상세 오류 정보:")
            traceback.print_exc()

        # 오류 알림 전송
        error_context = {
            'execution_mode': 'manual' if is_manual_trigger() else 'automatic',
            'environment': 'local' if is_local_environment() else 'github_actions',
            'test_mode': TEST_MODE
        }
        send_error_alert(str(e), error_context)
        sys.exit(1)


if __name__ == "__main__":
    main()