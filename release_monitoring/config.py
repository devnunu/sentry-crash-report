"""
릴리즈 모니터링 시스템 설정 관리
"""

import os
from pathlib import Path

# 환경 감지
TEST_MODE = os.getenv('TEST_MODE', 'false').lower() == 'true'

def is_local_environment():
    """로컬 환경인지 확인 (.env 파일 존재 여부로 판단)"""
    root_env = Path(__file__).parent.parent / '.env'
    return root_env.exists()

def load_environment():
    """환경변수 로드"""
    if is_local_environment():
        try:
            from dotenv import load_dotenv
            # 루트 디렉토리의 .env 파일 로드
            env_path = Path(__file__).parent.parent / '.env'
            load_dotenv(env_path)
            print(f"✅ {env_path}에서 환경변수를 로드했습니다.")
        except ImportError:
            print("⚠️ python-dotenv가 설치되지 않았습니다. pip install python-dotenv")

def get_input_value(key, default=None):
    """GitHub Actions INPUT 또는 환경변수에서 값 가져오기"""
    # GitHub Actions 입력값 (우선순위 1)
    github_input = os.getenv(f'INPUT_{key.upper()}')
    if github_input:
        return github_input

    # 로컬 테스트용 환경변수 (우선순위 2)
    test_input = os.getenv(f'TEST_{key.upper()}')
    if test_input:
        return test_input

    # 기본값
    return default

# Sentry 설정
SENTRY_TOKEN = os.getenv('SENTRY_AUTH_TOKEN')
ORG_SLUG = os.getenv('SENTRY_ORG_SLUG')
PROJECT_SLUG = os.getenv('SENTRY_PROJECT_SLUG')
PROJECT_ID = os.getenv('SENTRY_PROJECT_ID')
ENVIRONMENT = os.getenv('SENTRY_ENVIRONMENT', 'Production')

# Slack 설정
SLACK_WEBHOOK = os.getenv('SLACK_WEBHOOK_URL')
DASH_BOARD_ID = os.getenv('DASH_BOARD_ID')

# Sentry API 설정
SENTRY_API_BASE = "https://sentry.io/api/0"
HEADERS = {
    'Authorization': f'Bearer {SENTRY_TOKEN}',
    'Content-Type': 'application/json'
}

# 모니터링 설정
MONITORING_PERIODS = {
    'intensive_hours': 6,        # 집중 모니터링 기간 (시간)
    'total_days': 7,            # 전체 모니터링 기간 (일)
    'check_interval': 15,       # 체크 간격 (분)
}

# 위험도 임계값
ALERT_THRESHOLDS = {
    'new_crash_threshold': 5,           # 신규 크래시 임계값
    'increase_threshold_warning': 1.5,  # 50% 증가 시 경고
    'increase_threshold_danger': 2.0,   # 100% 증가 시 위험
    'critical_user_impact': 20,         # 20명 이상 영향 시 Critical
}

# 상태 파일 경로
MONITORING_STATE_FILE = Path(__file__).parent / 'monitoring_state.json'

# 한국 시간대 설정
from datetime import timezone, timedelta
KST = timezone(timedelta(hours=9))

def get_current_kst():
    """현재 한국 시간 반환"""
    from datetime import datetime
    return datetime.now(KST)

def get_current_utc():
    """현재 UTC 시간 반환"""
    from datetime import datetime
    return datetime.now(timezone.utc)

def kst_to_utc(kst_datetime):
    """KST를 UTC로 변환"""
    if kst_datetime.tzinfo is None:
        kst_datetime = kst_datetime.replace(tzinfo=KST)
    return kst_datetime.astimezone(timezone.utc)

def utc_to_kst(utc_datetime):
    """UTC를 KST로 변환"""
    if utc_datetime.tzinfo is None:
        utc_datetime = utc_datetime.replace(tzinfo=timezone.utc)
    return utc_datetime.astimezone(KST)

def validate_configuration():
    """필수 설정 유효성 검사"""
    missing_vars = []

    required_vars = {
        'SENTRY_AUTH_TOKEN': SENTRY_TOKEN,
        'SENTRY_ORG_SLUG': ORG_SLUG,
        'SENTRY_PROJECT_SLUG': PROJECT_SLUG,
        'SENTRY_PROJECT_ID': PROJECT_ID,
    }

    for var_name, value in required_vars.items():
        if not value:
            missing_vars.append(var_name)

    if missing_vars:
        print("❌ 필수 환경변수가 설정되지 않았습니다:")
        for var in missing_vars:
            print(f"   - {var}")
        return False

    # PROJECT_ID 숫자 확인
    try:
        int(PROJECT_ID)
    except (ValueError, TypeError):
        print(f"❌ SENTRY_PROJECT_ID가 유효한 숫자가 아닙니다: {PROJECT_ID}")
        return False

    return True

def print_configuration():
    """현재 설정 출력"""
    print(f"🔧 릴리즈 모니터링 설정:")
    print(f"   - 실행 환경: {'로컬' if is_local_environment() else 'GitHub Actions'}")
    print(f"   - 테스트 모드: {'활성화' if TEST_MODE else '비활성화'}")
    print(f"   - Sentry 조직: {ORG_SLUG}")
    print(f"   - 프로젝트: {PROJECT_SLUG}")
    print(f"   - 환경: {ENVIRONMENT}")
    if SLACK_WEBHOOK:
        print(f"   - Slack 알림: 설정됨")
    else:
        print(f"   - Slack 알림: 미설정")