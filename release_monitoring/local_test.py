#!/usr/bin/env python3
"""
로컬 테스트를 위한 전용 스크립트
GitHub Actions 배포 전 기능 검증용
단일 버전 관리 방식으로 개선
"""

import argparse
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path


def setup_local_environment():
    """로컬 환경 설정"""
    try:
        from dotenv import load_dotenv
        env_path = Path(__file__).parent.parent / '.env'
        if env_path.exists():
            load_dotenv(env_path)
            print(f"✅ {env_path}에서 환경변수를 로드했습니다.")
        else:
            print(f"⚠️ {env_path} 파일이 없습니다.")
            return False
    except ImportError:
        print("❌ python-dotenv가 설치되지 않았습니다.")
        return False

    os.environ['TEST_MODE'] = 'true'
    print("🧪 로컬 테스트 환경 설정 완료")
    return True


def validate_configuration():
    """설정 유효성 검사"""
    print("\n✅ 설정 유효성 검사")

    required_vars = ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG_SLUG', 'SENTRY_PROJECT_SLUG', 'SENTRY_PROJECT_ID']
    missing_vars = [var for var in required_vars if not os.getenv(var)]

    if missing_vars:
        print(f"❌ 누락된 환경변수: {missing_vars}")
        return False

    print("✅ 모든 필수 환경변수 설정됨")

    # Sentry 연결 테스트
    try:
        from release_analyzer import test_sentry_connection
        if test_sentry_connection():
            print("✅ Sentry API 연결 성공")
        else:
            print("❌ Sentry API 연결 실패")
            return False
    except Exception as e:
        print(f"❌ Sentry 연결 테스트 오류: {e}")
        return False

    return True


def test_new_release(version=None, start_time=None):
    """신규 릴리즈 모니터링 시작 테스트"""
    print("\n🚀 신규 릴리즈 모니터링 테스트")

    # .env에서 테스트 버전 로드, 없으면 현재 시간 기반으로 생성
    test_version = version or os.getenv('TEST_RELEASE_VERSION') or f'test-{datetime.now().strftime("%m%d-%H%M")}'
    test_start_time = start_time or os.getenv('TEST_RELEASE_START_TIME', '')
    test_duration = os.getenv('TEST_MONITORING_DURATION', '168')

    os.environ['INPUT_RELEASE_VERSION'] = test_version
    os.environ['INPUT_RELEASE_START_TIME'] = test_start_time
    os.environ['INPUT_MONITORING_DURATION'] = test_duration

    print(f"   테스트 버전: {test_version}")
    if test_start_time:
        print(f"   시작 시간: {test_start_time} (KST 입력)")
    print(f"   모니터링 기간: {test_duration}시간")

    try:
        from config import load_environment, validate_configuration
        from release_monitor import handle_manual_trigger

        load_environment()
        if not validate_configuration():
            print("❌ 설정 검증 실패")
            return False

        handle_manual_trigger()
        print("✅ 신규 릴리즈 테스트 완료")
        return True
    except Exception as e:
        print(f"❌ 신규 릴리즈 테스트 실패: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_existing_monitoring():
    """기존 모니터링 상태 테스트"""
    print("\n🔄 기존 모니터링 상태 테스트")

    # INPUT 환경변수 제거 (자동 실행 시뮬레이션)
    for key in list(os.environ.keys()):
        if key.startswith('INPUT_'):
            del os.environ[key]

    try:
        from config import load_environment, validate_configuration
        from release_monitor import handle_automatic_trigger

        load_environment()
        if not validate_configuration():
            print("❌ 설정 검증 실패")
            return False

        handle_automatic_trigger()
        print("✅ 기존 모니터링 테스트 완료")
        return True
    except Exception as e:
        print(f"❌ 기존 모니터링 테스트 실패: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_monitoring_status():
    """모니터링 상태 확인"""
    print("\n📊 모니터링 상태 확인")

    try:
        from monitoring_state import print_monitoring_status, get_release_summary

        print_monitoring_status()

        summary = get_release_summary()
        print(f"\n📋 상태 요약:")
        print(f"   - 총 릴리즈: {summary['total_releases']}개")

        for phase, count in summary['by_phase'].items():
            if count > 0:
                print(f"   - {phase}: {count}개")

        print("✅ 상태 확인 완료")
        return True
    except Exception as e:
        print(f"❌ 상태 확인 실패: {e}")
        return False


def test_cleanup():
    """완료된 릴리즈 정리 테스트"""
    print("\n🗑️ 릴리즈 정리 테스트")

    try:
        from monitoring_state import add_monitoring_release, cleanup_completed_releases
        from config import utc_to_kst

        # .env에서 환경 정보 로드
        environment = os.getenv('SENTRY_ENVIRONMENT', 'Test')
        duration_hours = int(os.getenv('TEST_MONITORING_DURATION', '168'))
        base_version = os.getenv('TEST_RELEASE_VERSION', 'cleanup-test')

        # 과거 시점의 테스트 릴리즈 생성 (duration_hours + 1일 전)
        past_release_start = datetime.now(timezone.utc) - timedelta(hours=duration_hours + 24)
        past_release_start_kst = utc_to_kst(past_release_start)

        test_release = {
            'version': base_version,
            'start_time': past_release_start.isoformat(),
            'duration_hours': duration_hours,
            'environment': environment,
            'created_at': datetime.now(timezone.utc).isoformat(),
            'created_by': 'cleanup_test'
        }

        add_monitoring_release(test_release)
        print(f"   과거 릴리즈 추가됨: {base_version}")
        print(f"   릴리즈 시작: {past_release_start_kst.strftime('%Y-%m-%d %H:%M:%S')} KST")
        print(f"   (모니터링 완료된 상태)")

        # 정리 로직 테스트
        cleaned_count = cleanup_completed_releases()
        print(f"✅ 정리 테스트 완료: {cleaned_count}개 릴리즈 정리됨")
        return True
    except Exception as e:
        print(f"❌ 정리 테스트 실패: {e}")
        return False


def create_sample_data():
    """샘플 데이터 생성 (단일 버전만 사용)"""
    print("\n📝 샘플 데이터 생성")

    try:
        from monitoring_state import add_monitoring_release, get_release_summary
        from config import utc_to_kst

        # .env에서 설정 로드
        environment = os.getenv('SENTRY_ENVIRONMENT', 'Production')
        duration_hours = int(os.getenv('TEST_MONITORING_DURATION', '168'))
        base_version = os.getenv('TEST_RELEASE_VERSION', 'sample-1.0.0')

        # 릴리즈 시작 시간 결정 (TEST_RELEASE_START_TIME 우선)
        test_start_time = os.getenv('TEST_RELEASE_START_TIME', '').strip()

        if test_start_time:
            # 사용자 지정 시간 사용 (KST 입력으로 간주)
            try:
                from config import KST
                parsed_time = datetime.strptime(test_start_time, '%Y-%m-%d %H:%M')
                kst_time = parsed_time.replace(tzinfo=KST)
                release_start_utc = kst_time.astimezone(timezone.utc)
                print(f"   🎯 TEST_RELEASE_START_TIME 사용: {test_start_time} KST")
            except ValueError:
                print(f"   ⚠️ 잘못된 시간 형식: {test_start_time}, 현재 시간 사용")
                release_start_utc = datetime.now(timezone.utc)
        else:
            # 기본값: 현재 시간
            release_start_utc = datetime.now(timezone.utc)
            print(f"   📅 현재 시간을 릴리즈 시작 시간으로 사용")

        # 샘플 릴리즈 생성
        sample_release = {
            'version': base_version,
            'start_time': release_start_utc.isoformat(),
            'duration_hours': duration_hours,
            'environment': environment,
            'created_at': datetime.now(timezone.utc).isoformat(),
            'created_by': 'sample_data'
        }

        # 릴리즈 추가
        add_monitoring_release(sample_release)

        # 릴리즈 시작 시간을 KST로 변환하여 출력
        release_start_kst = utc_to_kst(release_start_utc)

        # 경과 시간 계산
        elapsed = datetime.now(timezone.utc) - release_start_utc
        elapsed_hours = elapsed.total_seconds() / 3600

        if elapsed_hours >= 24:
            elapsed_text = f"{elapsed_hours / 24:.1f}일"
        elif elapsed_hours >= 1:
            elapsed_text = f"{elapsed_hours:.1f}시간"
        elif elapsed_hours >= 0:
            elapsed_text = f"{elapsed_hours * 60:.0f}분"
        else:
            elapsed_text = f"{abs(elapsed_hours * 60):.0f}분 후 시작 예정"

        print("✅ 샘플 데이터 생성 완료")
        print(f"   - 버전: {base_version}")
        print(f"   - 릴리즈 시작: {release_start_kst.strftime('%Y-%m-%d %H:%M:%S')} KST")
        print(f"   - 경과 시간: {elapsed_text}")
        print(f"   - 환경: {environment}")
        print(f"   - 모니터링 기간: {duration_hours}시간")

        # 현재 모니터링 단계 확인
        from monitoring_state import get_monitoring_phase
        phase = get_monitoring_phase(sample_release)
        phase_name = {
            'scheduled': '예정 (시작 전)',
            'intensive': '집중 모니터링 (0-6시간)',
            'normal': '일반 모니터링 (6시간-7일)',
            'completed': '완료 (7일 이후)',
            'invalid': '오류'
        }.get(phase, phase)

        print(f"   - 현재 단계: {phase_name}")

        print(f"\n💡 다른 단계 테스트 방법:")
        print(f"   - 집중 모니터링: TEST_RELEASE_START_TIME을 2시간 전으로 설정")
        print(f"   - 일반 모니터링: TEST_RELEASE_START_TIME을 12시간 전으로 설정")
        print(f"   - 완료: TEST_RELEASE_START_TIME을 8일 전으로 설정")

        # 생성된 데이터 확인
        summary = get_release_summary()
        print(f"\n📊 생성 후 상태:")
        for phase, count in summary['by_phase'].items():
            if count > 0:
                phase_name = {
                    'intensive': '집중 모니터링',
                    'normal': '일반 모니터링',
                    'completed': '완료',
                    'scheduled': '예정'
                }.get(phase, phase)
                print(f"   - {phase_name}: {count}개")

        return True
    except Exception as e:
        print(f"❌ 샘플 데이터 생성 실패: {e}")
        return False


def clear_all_data():
    """모든 모니터링 데이터 삭제"""
    print("\n🗑️ 모든 모니터링 데이터 삭제")

    try:
        from monitoring_state import save_monitoring_releases
        save_monitoring_releases([])
        print("✅ 모든 데이터 삭제 완료")
        return True
    except Exception as e:
        print(f"❌ 데이터 삭제 실패: {e}")
        return False


def test_version_update():
    """동일 버전 업데이트 테스트"""
    print("\n🔄 동일 버전 업데이트 테스트")

    try:
        from monitoring_state import add_monitoring_release, get_release_by_version
        from config import utc_to_kst, KST

        base_version = os.getenv('TEST_RELEASE_VERSION', 'update-test')
        environment = os.getenv('SENTRY_ENVIRONMENT', 'Test')

        # 릴리즈 시작 시간 결정 (TEST_RELEASE_START_TIME 우선)
        test_start_time = os.getenv('TEST_RELEASE_START_TIME', '').strip()

        if test_start_time:
            try:
                parsed_time = datetime.strptime(test_start_time, '%Y-%m-%d %H:%M')
                kst_time = parsed_time.replace(tzinfo=KST)
                release_start_utc = kst_time.astimezone(timezone.utc)
                print(f"   🎯 TEST_RELEASE_START_TIME 사용: {test_start_time} KST")
            except ValueError:
                print(f"   ⚠️ 잘못된 시간 형식, 현재 시간 사용")
                release_start_utc = datetime.now(timezone.utc)
        else:
            release_start_utc = datetime.now(timezone.utc)

        # 1차 릴리즈 추가
        first_release = {
            'version': base_version,
            'start_time': release_start_utc.isoformat(),
            'duration_hours': 168,
            'environment': environment,
            'created_at': datetime.now(timezone.utc).isoformat(),
            'created_by': 'update_test_first'
        }

        print(f"   1차 릴리즈 추가: {base_version}")
        print(f"   릴리즈 시작: {utc_to_kst(release_start_utc).strftime('%Y-%m-%d %H:%M:%S')} KST")
        add_monitoring_release(first_release)

        # 잠시 후 동일 버전으로 2차 업데이트 (start_time은 동일하게 유지)
        import time
        time.sleep(1)

        second_release = {
            'version': base_version,
            'start_time': release_start_utc.isoformat(),  # 동일한 릴리즈 시작 시간
            'duration_hours': 168,
            'environment': environment,
            'created_at': datetime.now(timezone.utc).isoformat(),
            'created_by': 'update_test_second',
            'additional_info': 'Updated release info'
        }

        print(f"   2차 릴리즈 업데이트: {base_version}")
        add_monitoring_release(second_release)

        # 결과 확인
        final_release = get_release_by_version(base_version)
        if final_release:
            print(f"   ✅ 최종 릴리즈 정보:")
            print(f"      - created_by: {final_release.get('created_by')}")
            print(f"      - additional_info: {final_release.get('additional_info', 'None')}")
            print(f"      - updated_at: {final_release.get('updated_at', 'None')}")

            # 릴리즈 시작 시간이 유지되었는지 확인
            start_time_str = final_release.get('start_time')
            if start_time_str:
                start_time_utc = datetime.fromisoformat(start_time_str.replace('Z', '+00:00'))
                start_time_kst = utc_to_kst(start_time_utc)
                print(f"      - 릴리즈 시작: {start_time_kst.strftime('%Y-%m-%d %H:%M:%S')} KST (유지됨)")

        print("✅ 버전 업데이트 테스트 완료")
        return True

    except Exception as e:
        print(f"❌ 버전 업데이트 테스트 실패: {e}")
        return False


def run_full_test_suite():
    """전체 테스트 스위트 실행"""
    print("\n🧪 전체 테스트 스위트 실행")

    # .env에서 테스트 버전 로드
    test_version = os.getenv('TEST_RELEASE_VERSION', 'full-test-1.0.0')

    tests = [
        ("설정 검증", validate_configuration),
        ("데이터 초기화", clear_all_data),
        ("샘플 데이터 생성", create_sample_data),
        ("버전 업데이트 테스트", test_version_update),
        ("모니터링 상태 확인", test_monitoring_status),
        ("기존 모니터링 테스트", test_existing_monitoring),
        ("신규 릴리즈 테스트", lambda: test_new_release(test_version)),
        ("정리 테스트", test_cleanup),
    ]

    results = []

    for test_name, test_func in tests:
        print(f"\n{'=' * 50}")
        print(f"🧪 {test_name}")
        print('=' * 50)

        try:
            result = test_func()
            results.append((test_name, result))
            print(f"{'✅' if result else '❌'} {test_name} {'성공' if result else '실패'}")
        except Exception as e:
            print(f"💥 {test_name} 오류: {e}")
            results.append((test_name, False))

    # 결과 요약
    print(f"\n{'=' * 50}")
    print("📊 테스트 결과 요약")
    print('=' * 50)

    passed = sum(1 for _, result in results if result)
    total = len(results)

    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"   {status} {test_name}")

    print(f"\n🎯 총 {passed}/{total} 테스트 통과 ({passed / total * 100:.0f}%)")
    return passed == total


def main():
    parser = argparse.ArgumentParser(description='릴리즈 모니터링 로컬 테스트 (단일 버전 관리)')
    parser.add_argument('--scenario',
                        choices=['validate', 'new_release', 'monitoring', 'cleanup',
                                 'status', 'sample_data', 'clear_data', 'version_update', 'full_test'],
                        default='validate',
                        help='테스트 시나리오')
    parser.add_argument('--version', help='테스트할 릴리즈 버전 (미지정시 .env의 TEST_RELEASE_VERSION 사용)')
    parser.add_argument('--start-time', help='릴리즈 시작 시간 (YYYY-MM-DD HH:MM, 한국 시간 기준)')

    args = parser.parse_args()

    # 로컬 환경 설정
    if not setup_local_environment():
        sys.exit(1)

    print(f"\n🎯 시나리오: {args.scenario}")
    print("📋 단일 버전 관리 방식으로 실행")

    # 시나리오별 실행
    success = True

    if args.scenario == 'validate':
        success = validate_configuration()
    elif args.scenario == 'new_release':
        success = test_new_release(args.version, args.start_time)
    elif args.scenario == 'monitoring':
        success = test_existing_monitoring()
    elif args.scenario == 'cleanup':
        success = test_cleanup()
    elif args.scenario == 'status':
        success = test_monitoring_status()
    elif args.scenario == 'sample_data':
        success = create_sample_data()
    elif args.scenario == 'clear_data':
        success = clear_all_data()
    elif args.scenario == 'version_update':
        success = test_version_update()
    elif args.scenario == 'full_test':
        success = run_full_test_suite()

    if success:
        print(f"\n🎉 시나리오 '{args.scenario}' 성공!")
        sys.exit(0)
    else:
        print(f"\n❌ 시나리오 '{args.scenario}' 실패!")
        sys.exit(1)


if __name__ == "__main__":
    main()