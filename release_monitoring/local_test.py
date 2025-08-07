#!/usr/bin/env python3
"""
로컬 테스트를 위한 전용 스크립트
GitHub Actions 배포 전 기능 검증용
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

        # 과거 시점의 테스트 릴리즈 생성 (duration_hours + 1일 전)
        past_time = datetime.now(timezone.utc) - timedelta(hours=duration_hours + 24)
        past_time_kst = utc_to_kst(past_time)

        test_release = {
            'version': 'old-test-release',
            'start_time': past_time.isoformat(),
            'duration_hours': duration_hours,
            'environment': environment,
            'created_at': datetime.now(timezone.utc).isoformat(),
            'created_by': 'local_test'
        }

        add_monitoring_release(test_release)
        print(f"   과거 릴리즈 추가됨 (시작: {past_time_kst.strftime('%Y-%m-%d %H:%M:%S')} KST)")

        # 정리 로직 테스트
        cleaned_count = cleanup_completed_releases()
        print(f"✅ 정리 테스트 완료: {cleaned_count}개 릴리즈 정리됨")
        return True
    except Exception as e:
        print(f"❌ 정리 테스트 실패: {e}")
        return False


def create_sample_data():
    """샘플 데이터 생성"""
    print("\n📝 샘플 데이터 생성")

    try:
        from monitoring_state import add_monitoring_release
        from config import utc_to_kst

        # .env에서 설정 로드
        environment = os.getenv('SENTRY_ENVIRONMENT', 'Production')
        duration_hours = int(os.getenv('TEST_MONITORING_DURATION', '168'))
        base_version = os.getenv('TEST_RELEASE_VERSION', 'sample')

        # 집중 모니터링 단계 (2시간 전)
        intensive_time = datetime.now(timezone.utc) - timedelta(hours=2)
        intensive_time_kst = utc_to_kst(intensive_time)

        intensive_release = {
            'version': f'{base_version}-intensive',
            'start_time': intensive_time.isoformat(),
            'duration_hours': duration_hours,
            'environment': environment,
            'created_at': datetime.now(timezone.utc).isoformat(),
            'created_by': 'sample_data'
        }

        # 일반 모니터링 단계 (12시간 전)
        normal_time = datetime.now(timezone.utc) - timedelta(hours=12)
        normal_time_kst = utc_to_kst(normal_time)

        normal_release = {
            'version': f'{base_version}-normal',
            'start_time': normal_time.isoformat(),
            'duration_hours': duration_hours,
            'environment': environment,
            'created_at': datetime.now(timezone.utc).isoformat(),
            'created_by': 'sample_data'
        }

        add_monitoring_release(intensive_release)
        add_monitoring_release(normal_release)

        print("✅ 샘플 데이터 생성 완료")
        print(f"   - 집중 모니터링: {base_version}-intensive ({intensive_time_kst.strftime('%Y-%m-%d %H:%M:%S')} KST)")
        print(f"   - 일반 모니터링: {base_version}-normal ({normal_time_kst.strftime('%Y-%m-%d %H:%M:%S')} KST)")
        print(f"   - 환경: {environment}")
        print(f"   - 모니터링 기간: {duration_hours}시간")
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


def run_full_test_suite():
    """전체 테스트 스위트 실행"""
    print("\n🧪 전체 테스트 스위트 실행")

    # .env에서 테스트 버전 로드
    test_version = os.getenv('TEST_RELEASE_VERSION', 'full-test-1.0.0')

    tests = [
        ("설정 검증", validate_configuration),
        ("샘플 데이터 생성", create_sample_data),
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
    parser = argparse.ArgumentParser(description='릴리즈 모니터링 로컬 테스트')
    parser.add_argument('--scenario',
                        choices=['validate', 'new_release', 'monitoring', 'cleanup',
                                 'status', 'sample_data', 'clear_data', 'full_test'],
                        default='validate',
                        help='테스트 시나리오')
    parser.add_argument('--version', help='테스트할 릴리즈 버전 (미지정시 .env의 TEST_RELEASE_VERSION 사용)')
    parser.add_argument('--start-time', help='릴리즈 시작 시간 (YYYY-MM-DD HH:MM, 한국 시간 기준)')

    args = parser.parse_args()

    # 로컬 환경 설정
    if not setup_local_environment():
        sys.exit(1)

    print(f"\n🎯 시나리오: {args.scenario}")

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