# 릴리즈 후 모니터링 알림 시스템

새로운 Android 앱 버전 배포 후 일정 기간 동안 크래시 및 중요 이슈를 모니터링하여 개발팀에게 실시간 알림을 제공하는 시스템입니다.

## 🎯 주요 기능

- ✅ **단계별 모니터링**: 집중 모니터링(6시간) → 일반 모니터링(7일)
- ✅ **실시간 위험도 감지**: Level 1-5 단계별 알림
- ✅ **스마트 실행**: 모니터링 대상이 없으면 빠른 종료
- ✅ **로컬 테스트**: 배포 전 안전한 검증 환경
- ✅ **자동 정리**: 완료된 모니터링 자동 제거

## 📁 파일 구조

```
project/
├── .env                           # 공통 환경변수 파일
├── .env_template                  # 환경변수 템플릿
├── daily_crash_report.py          # 기존 일간 리포트
├── weekly_crash_report.py         # 기존 주간 리포트
├── .github/workflows/
│   └── release-monitoring.yml     # GitHub Actions 워크플로우
└── release_monitoring/            # 릴리즈 모니터링 시스템
    ├── __init__.py               # Python 패키지 파일
    ├── release_monitor.py         # 메인 모니터링 로직
    ├── config.py                  # 설정 관리
    ├── monitoring_state.py        # 상태 관리
    ├── release_analyzer.py        # 릴리즈 분석
    ├── alert_sender.py           # 알림 발송
    ├── local_test.py             # 로컬 테스트 스크립트
    └── monitoring_state.json     # 모니터링 상태 (자동 생성)
```

## 🚀 빠른 시작

### 1. 환경 설정

```bash
# 1. 환경변수 파일 생성
cp .env_template .env

# 2. .env 파일 편집 (실제 토큰 입력)
# SENTRY_AUTH_TOKEN=your_token
# SENTRY_ORG_SLUG=your_org
# ...

# 3. 의존성 설치
pip install requests python-dotenv
```

### 2. 로컬 테스트

```bash
# 설정 검증
python release_monitoring/local_test.py --scenario validate

# 신규 릴리즈 테스트
python release_monitoring/local_test.py --scenario new_release --version 1.2.3

# 기존 모니터링 테스트
python release_monitoring/local_test.py --scenario monitoring

# 전체 테스트 실행
python release_monitoring/local_test.py --scenario full_test

# 현재 상태 확인
python release_monitoring/local_test.py --scenario status
```

### 3. GitHub Actions 배포

```bash
# GitHub Secrets 설정 (Settings > Secrets and variables > Actions)
SENTRY_AUTH_TOKEN=your_sentry_token
SENTRY_ORG_SLUG=your_org_slug
SENTRY_PROJECT_SLUG=your_project_slug
SENTRY_PROJECT_ID=your_project_id
SLACK_WEBHOOK_URL=your_slack_webhook
SENTRY_ENVIRONMENT=Production
DASH_BOARD_ID=your_dashboard_id  # 선택사항

# 워크플로우 파일 푸시
git add .
git commit -m "Add release monitoring system"
git push
```

## 📊 사용 방법

### 새 릴리즈 모니터링 시작

#### GitHub Actions (추천)
```bash
# GitHub에서 Actions 탭 → Release Monitoring → Run workflow
# 또는 CLI 사용:
gh workflow run release-monitoring.yml \
  -f release_version=1.2.3 \
  -f release_start_time="2024-01-15 12:00"
```

#### 로컬 실행
```bash
python release_monitoring/release_monitor.py --version 1.2.3 --start-time "2024-01-15 12:00"
```

### 현재 상태 확인

```bash
# 로컬에서 상태 확인
python release_monitoring/release_monitor.py --status

# 또는 테스트 스크립트 사용
python release_monitoring/local_test.py --scenario status
```

## ⚙️ 모니터링 단계

### 1. 집중 모니터링 (0-6시간)
- **실행 빈도**: 15분마다
- **목적**: 초기 Critical 이슈 빠른 감지
- **알림**: 즉시 알림 (Level 4-5 발생 시)

### 2. 일반 모니터링 (6시간-7일)
- **실행 빈도**: 1시간마다
- **목적**: 장기 안정성 확인
- **알림**: 주기적 요약 리포트

### 3. 완료 (7일 후)
- **자동 정리**: 상태에서 제거
- **최종 리포트**: 7일간 종합 분석

## 🚨 위험도 레벨

| Level | 기준 | 알림 | 조치 |
|-------|------|------|------|
| **Level 1** | 정상 (±10% 이내) | 정기 리포트 | 정상 모니터링 |
| **Level 2** | 주의 (+10-50%) | 주의 알림 | 지속 관찰 |
| **Level 3** | 경고 (+50-100%) | 경고 알림 | 패턴 분석 |
| **Level 4** | 위험 (+100% 이상) | 즉시 알림 | 롤백 검토 |
| **Level 5** | 긴급 (Fatal 다수) | 긴급 알림 | 즉시 대응 |

## 📱 알림 예시

### Critical 알림 (Level 4-5)
```
🚨 긴급: v1.2.3 릴리즈 문제 감지
━━━━━━━━━━━━━━━━━━━━━━
📱 버전: v1.2.3 (배포 후 23분)
⚠️ 위험도: Level 4 (위험)
📊 크래시: 12건 (신규 발생)
👥 영향 사용자: 45명

🔥 주요 이슈:
1. 🔴 NullPointerException in LoginActivity
   - 발생: 8건, 영향: 23명
2. 🟠 OutOfMemoryError in ImageLoader
   - 발생: 4건, 영향: 22명

💡 권장 조치:
• 🚨 즉시 롤백 검토 필요
• 📞 개발팀 긴급 소집
• 🔍 상위 크래시 이슈 우선 분석
```

### 요약 리포트 (Level 1-3)
```
📊 v1.2.3 모니터링 리포트 (배포 후 6시간)
━━━━━━━━━━━━━━━━━━━━━━
✅ 상태: 안정 (Level 1)
📈 크래시: 3건 ➡️
👥 영향 사용자: 12명
🎯 다음 체크: 1시간 후
```

## 🧪 로컬 테스트 가이드

### 기본 테스트
```bash
# 1. 환경 검증
python local_test.py --scenario validate

# 2. 샘플 데이터 생성
python local_test.py --scenario sample_data

# 3. 모니터링 테스트
python local_test.py --scenario monitoring

# 4. 데이터 정리
python local_test.py --scenario clear_data
```

### 시나리오별 테스트
```bash
# 신규 릴리즈 (커스텀 버전)
python local_test.py --scenario new_release --version "test-1.0.0"

# 과거 시점 릴리즈
python local_test.py --scenario new_release \
  --version "past-release" \
  --start-time "2024-01-10 15:30"

# 정리 작업만
python local_test.py --scenario cleanup
```

## 🔧 설정 옵션

### 환경변수 (.env)
```bash
# 필수 설정
SENTRY_AUTH_TOKEN=your_token
SENTRY_ORG_SLUG=your_org
SENTRY_PROJECT_SLUG=your_project  
SENTRY_PROJECT_ID=12345
SLACK_WEBHOOK_URL=https://hooks.slack.com/...

# 선택 설정
SENTRY_ENVIRONMENT=Production
DASH_BOARD_ID=dashboard_id

# 테스트 설정
TEST_MODE=true                    # Slack 전송 비활성화
```

### 모니터링 설정 (config.py)
```python
# 모니터링 기간
MONITORING_PERIODS = {
    'intensive_hours': 6,        # 집중 모니터링 (시간)
    'total_days': 7,            # 전체 모니터링 (일)
    'check_interval': 15,       # 체크 간격 (분)
}

# 알림 임계값
ALERT_THRESHOLDS = {
    'new_crash_threshold': 5,           # 신규 크래시 임계값
    'increase_threshold_warning': 1.5,  # 50% 증가 시 경고
    'increase_threshold_danger': 2.0,   # 100% 증가 시 위험
    'critical_user_impact': 20,         # Critical 사용자 영향
}
```

## 📈 모니터링 워크플로우

### 정상 배포 시나리오
```
1. 릴리즈 배포 완료
   ↓
2. 모니터링 시작 (수동 실행)
   ↓
3. 집중 모니터링 (6시간, 15분 간격)
   ↓ 
4. 일반 모니터링 (7일, 1시간 간격)
   ↓
5. 자동 완료 및 정리
```

### 문제 발생 시나리오
```
1. 크래시 감지 (30분 후)
   ↓
2. Critical 알림 발송 (Level 4)
   ↓
3. 개발팀 확인 및 분석
   ↓
4. 롤백 또는 핫픽스 적용
   ↓
5. 추가 모니터링 계속
```

## 🔍 문제 해결

### 일반적인 문제들

#### 1. Sentry 연결 실패
```bash
# 토큰 및 설정 확인
python local_test.py --scenario validate

# 수동 연결 테스트
python -c "from release_analyzer import test_sentry_connection; test_sentry_connection()"
```

#### 2. Slack 전송 실패
```bash
# Webhook URL 확인
curl -X POST -H 'Content-type: application/json' \
  --data '{"text":"테스트 메시지"}' \
  YOUR_SLACK_WEBHOOK_URL
```

#### 3. 모니터링 상태 이상
```bash
# 상태 파일 확인
cat monitoring_state.json

# 상태 초기화
python local_test.py --scenario clear_data
```

#### 4. GitHub Actions 실행 오류
```bash
# 로컬에서 동일 환경 재현
export INPUT_RELEASE_VERSION=1.2.3
python release_monitor.py

# Secrets 설정 확인
gh secret list
```

### 로그 및 디버깅

#### 상세 로그 활성화
```bash
# .env 파일에 추가
DEBUG_OUTPUT=true
TEST_MODE=true

# 실행 시 상세 정보 출력
python release_monitor.py --version test-debug
```

#### GitHub Actions 디버깅
```yaml
# 워크플로우에 디버그 스텝 추가
- name: Debug Environment
  run: |
    echo "Environment variables:"
    env | grep SENTRY_ | sort
    echo "Current directory:"
    pwd
    echo "Files:"
    ls -la
```

## 📚 API 참조

### 주요 함수들

#### monitoring_state.py
```python
# 릴리즈 추가
add_monitoring_release(release_data: Dict) -> bool

# 활성 릴리즈 조회
get_active_monitoring_releases() -> List[Dict]

# 모니터링 단계 확인
get_monitoring_phase(release: Dict) -> str

# 완료된 릴리즈 정리
cleanup_completed_releases() -> int
```

#### release_analyzer.py
```python
# 릴리즈 영향 분석
analyze_release_impact(release: Dict) -> Dict

# Sentry 연결 테스트
test_sentry_connection() -> bool

# 위험도 계산
calculate_risk_level(current: Dict, baseline: Dict) -> Tuple[int, str, str]
```

#### alert_sender.py
```python
# Critical 알림 전송
send_critical_alert(analysis_result: Dict) -> bool

# 요약 리포트 전송  
send_summary_report(analysis_result: Dict) -> bool

# 완료 알림 전송
send_completion_notice(version: str, stats: Dict) -> bool
```

## 🤝 기여하기

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Test your changes (`python local_test.py --scenario full_test`)
4. Commit your changes (`git commit -m 'Add amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

## 📄 라이센스

이 프로젝트는 MIT 라이센스 하에 배포됩니다.

## 🆘 지원

문제가 발생하거나 질문이 있으시면:

1. [Issues](../../issues)에서 기존 이슈 확인
2. 새로운 이슈 생성 (템플릿 사용)
3. 로컬 테스트 결과와 함께 상세 정보 제공

---

**Happy Monitoring! 🚀**