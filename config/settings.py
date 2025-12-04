"""
Application settings module.

Pydantic Settings를 사용하여 환경변수를 로딩하고 검증합니다.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    애플리케이션 설정 클래스.
    
    환경변수 또는 .env 파일에서 설정값을 로딩합니다.
    """
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )
    
    # ----------------------------------------------------------------------
    # Sentry 기본 설정
    # ----------------------------------------------------------------------
    sentry_auth_token: str = ""
    sentry_org_slug: str = ""
    
    # ----------------------------------------------------------------------
    # Android 프로젝트 설정
    # ----------------------------------------------------------------------
    android_project_slug: str = ""
    android_project_id: str = ""
    android_sentry_environment: str = "production"
    
    # ----------------------------------------------------------------------
    # iOS 프로젝트 설정
    # ----------------------------------------------------------------------
    ios_project_slug: str = ""
    ios_project_id: str = ""
    
    # ----------------------------------------------------------------------
    # Slack 알림 설정
    # ----------------------------------------------------------------------
    slack_webhook_url: str = ""
    
    # ----------------------------------------------------------------------
    # 분석 서버 설정
    # ----------------------------------------------------------------------
    analysis_server_base_url: str = "http://localhost:9000"
    
    # ----------------------------------------------------------------------
    # 데이터베이스 설정
    # ----------------------------------------------------------------------
    database_url: str = "sqlite:///./sentry_ai.db"
    
    # ----------------------------------------------------------------------
    # 애플리케이션 설정
    # ----------------------------------------------------------------------
    app_env: str = "development"
    test_mode: bool = True
    
    # ----------------------------------------------------------------------
    # 중요도 판단 기준값 (Threshold)
    # ----------------------------------------------------------------------
    important_event_count_threshold: int = 10
    important_user_count_threshold: int = 5
    
    @property
    def is_production(self) -> bool:
        """프로덕션 환경인지 확인"""
        return self.app_env.lower() == "production"
    
    @property
    def is_test_mode(self) -> bool:
        """테스트 모드인지 확인"""
        return self.test_mode
    
    def get_sentry_project_url(self, project_slug: str, issue_id: str) -> str:
        """Sentry 이슈 URL을 생성합니다."""
        base_url = "https://sentry.io/organizations"
        return f"{base_url}/{self.sentry_org_slug}/issues/{issue_id}/?project={project_slug}"


@lru_cache()
def get_settings() -> Settings:
    """
    Settings 인스턴스를 캐시하여 반환합니다.
    
    lru_cache를 사용하여 설정을 한 번만 로드합니다.
    """
    return Settings()


# 전역 settings 인스턴스
settings = get_settings()
