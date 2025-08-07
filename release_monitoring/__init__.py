"""
릴리즈 후 모니터링 알림 시스템

새로운 Android 앱 버전 배포 후 일정 기간 동안 크래시 및 중요 이슈를 모니터링하여
개발팀에게 실시간 알림을 제공하는 시스템입니다.

주요 모듈:
- release_monitor: 메인 실행 로직
- config: 설정 관리 및 환경 감지
- monitoring_state: 모니터링 상태 관리
- release_analyzer: Sentry API 연동 및 릴리즈 분석
- alert_sender: Slack 알림 메시지 포맷팅 및 전송
- local_test: 로컬 테스트 스크립트
"""

__version__ = "1.0.0"
__author__ = "Release Monitoring Team"
__description__ = "Post-release monitoring and alerting system for Android apps"