# Sentry 크래시 모니터링 시스템 🛡️

Android/iOS 앱의 크래시를 실시간으로 모니터링하고 자동화된 리포트를 제공하는 종합 모니터링 시스템입니다. 일간, 주간, 릴리즈별 모니터링을 통해 앱 안정성을 체계적으로 관리합니다.

## 🎯 시스템 개요

이 시스템은 3가지 핵심 모니터링 기능을 제공합니다:

- **📅 일간 크래시 리포트**: 매일 전날의 크래시 현황 자동 분석 및 Slack 전송
- **📊 주간 크래시 리포트**: 매주 7일간의 트렌드 분석 및 이슈 생명주기 추적  
- **🚀 릴리즈 모니터링**: 새 버전 배포 후 실시간 안정성 모니터링

## 📁 프로젝트 구조

```
project/
├── .env                           # 공통 환경변수 파일
├── .env_template                  # 환경변수 템플릿
├── requirements.txt               # Python 의존성
├── daily_crash_report.py          # 일간 리포트 스크립트
├── weekly_crash_report.py         # 주간 리포트 스크립트
├── .github/workflows/
│   ├── daily-report.yml           # 일간 리포트 GitHub Actions
│   ├── weekly-report.yml          # 주간 리포트 GitHub Actions
│   └── release_monitoring.yml     # 릴리즈 모니터링 GitHub Actions
└── release_monitoring/            # 릴리즈 모니터링 시스템
    ├── __init__.py
    ├── release_monitor.py         # 메인 모니터링 로직
    ├── config.py                  # 설정 관리
    ├── monitoring_state.py        # 상태 관리
    ├── release_analyzer.py        # 릴리즈 분석
    ├── alert_sender.py           # 알림 발송
    ├── local_test.py             # 로컬 테스트 스크립트
    └── monitoring_state.json     # 모니터링 상태 (자동 생성)
```

## 🚀 빠른 시작

### 1. 공통 환경 설정

```bash
# 1. 저장소 클론
git clone <repository-url>
cd sentry-monitoring

# 2. 환경변수 파일 생성
cp .env_template .env

# 3. .env 파일 편집 (필수 설정)
# SENTRY_AUTH_TOKEN=your_sentry_token
# SENTRY_ORG_SLUG=your_org_slug
# SENTRY_PROJECT_SLUG=your_project_slug
# SENTRY_PROJECT_ID=your_project_id
# SLACK_WEBHOOK_URL=your_slack_webhook
# SENTRY_ENVIRONMENT=Production

# 4. 의존성 설치
pip install -r requirements.txt
```

### 2. GitHub Repository Secrets 설정

Repository → Settings → Secrets and variables → Actions에서 설정:

```bash
# 필수 Secrets
SENTRY_AUTH_TOKEN         # Sentry API 토큰
SENTRY_ORG_SLUG          # Sentry 조직명
SENTRY_PROJECT_SLUG      # Sentry 프로젝트명
SENTRY_PROJECT_ID        # Sentry 프로젝트 ID (숫자)
SLACK_WEBHOOK_URL        # Slack 웹훅 URL

# 선택 Secrets
SENTRY_ENVIRONMENT       # 환경 (기본값: Production)
DASH_BOARD_ID           # Sentry 대시보드 ID
```

### 3. 워크플로우 활성화

```bash
# 파일 커밋 및 푸시로 GitHub Actions 활성화
git add .
git commit -m "Add Sentry monitoring system"
git push
```

---

## 📅 일간 크래시 리포트

매일 전날(00:00~23:59)의 크래시 현황을 정확하게 분석하여 Slack으로 전송합니다.

### 🎯 주요 기능

- **정확한 데이터 수집**: 페이지네이션을 통한 완전한 이슈 수집
- **전날 비교 분석**: 증감률과 트렌드 분석
- **Top 5 이슈**: 심각도별 이모지와 Sentry 직접 링크
- **Crash-Free Rate**: 세션 기반 안정성 지표

### ⚙️ 자동 실행

- **실행 시간**: 매일 오전 9시 UTC (한국 시간 18시)
- **워크플로우**: `.github/workflows/daily-report.yml`
- **수동 실행**: GitHub Actions에서 workflow_dispatch 지원

### 🧪 로컬 테스트

```bash
# 테스트 모드 (Slack 전송 없음)
TEST_MODE=true python3 daily_crash_report.py

# 특정 날짜 테스트
TARGET_DATE=2025-01-26 TEST_MODE=true python3 daily_crash_report.py

# 실제 실행
python3 daily_crash_report.py
```

### 📊 리포트 예시

```
Android 일간 크래시 리포트
📅 2025년 01월 26일 | 상태: ⚠️ 주의 필요

📊 주요 지표
총 크래시: 192건 (전날 대비 +26.7% ↗️)
영향받은 사용자: 3,883명
발생한 이슈: 12개
Crash-Free Rate: 99.25%

🔝 Top 5 이슈
1. 🔴 QGLCCompileToIRShader - 52건
2. 🟠 NullPointerException - 27건  
3. 🟡 JsonParseException - 22건
4. 🟢 NumberFormatException - 12건
5. 🟢 UnknownHostException - 8건
```

### 🔧 설정 옵션

```bash
# .env 파일 설정
SENTRY_ENVIRONMENT=Production     # 모니터링 환경
DASH_BOARD_ID=dashboard_id       # 특정 대시보드 연결
TEST_MODE=false                  # 테스트 모드
```

---

## 📊 주간 크래시 리포트

매주 지난 7일간의 크래시 트렌드를 종합 분석하고 이슈 생명주기를 추적합니다.

### 🎯 주요 기능

- **요일별 정확한 집계**: 월~일 각각의 크래시 발생 건수 분석
- **이슈 생명주기 분석**: 신규/악화/개선/해결된 이슈 추적
- **이상 징후 탐지**: 급증, 임계점 돌파, 연속 증가 패턴 감지
- **전주 대비 분석**: 동일 기간 비교를 통한 변화 추이 파악

### ⚙️ 자동 실행

- **실행 시간**: 매주 월요일 오전 10시 UTC (한국 시간 19시)
- **워크플로우**: `.github/workflows/weekly-report.yml`
- **분석 범위**: 지난 7일 (월요일 ~ 일요일)

### 🧪 로컬 테스트

```bash
# 테스트 모드
TEST_MODE=true python3 weekly_crash_report.py

# 특정 주차 테스트 (해당 주의 월요일 날짜)
TARGET_WEEK_START=2025-01-20 TEST_MODE=true python3 weekly_crash_report.py

# 일관성 모드 (더 정확하지만 느림)
CONSISTENCY_MODE=true python3 weekly_crash_report.py
```

### 📈 이슈 생명주기 분석

**🆕 신규 발생**: 이번 주에 처음 발생한 이슈
- firstSeen이 이번 주 범위 내
- 발생 건수와 첫 발견일 표시

**⚠️ 악화**: 전주 대비 50% 이상 증가한 이슈
- 증가율과 전후 비교 수치

**✅ 개선**: 전주 대비 50% 이상 감소한 이슈  
- 감소율과 개선 정도

**🎉 해결 완료**: 더 이상 발생하지 않는 이슈
- 전주 10건 이상 → 이번 주 0건

### 📊 리포트 예시

```
Android 주간 크래시 리포트
📅 2025년 01월 20일 ~ 01월 26일 | 상태: ⚠️ 증가

📊 주요 지표
주간 총 크래시: 1,247건 (일평균 178건)
영향받은 사용자: 12,543명
전주 대비: +156건 📈

📈 요일별 크래시 현황
월 145건 화 167건 수 203건 목 189건 금 178건 토 156건 일 209건

🔄 이슈 생명주기 분석
🆕 신규 발생 (3개)
1. OutOfMemoryError - 45건 (01/22 첫 발생)

⚠️ 악화 (2개)  
1. NullPointerException +87% (34→64건)

✅ 개선 (1개)
1. ConnectionTimeoutException -67% (45→15건)
```

### 🔧 설정 옵션

```bash
# 주간 리포트 전용 설정
CONSISTENCY_MODE=true            # 정확성 향상 (처리 시간 증가)
TARGET_WEEK_START=2025-01-20    # 특정 주차 테스트
```

---

## 🚀 릴리즈 모니터링 시스템

새 버전 배포 후 실시간으로 안정성을 모니터링하여 위험도를 자동 평가하고 알림을 제공합니다.

### 🎯 주요 기능

- **5단계 레벨링 시스템**: 자동 위험도 평가 (Level 0-5)
- **적응적 모니터링**: 집중 모니터링(6시간) → 일반 모니터링(7일)
- **슬라이딩 윈도우 분석**: 시점별 정확한 데이터 분석
- **지능형 알림**: 위험도에 따른 차등 알림 시스템

### 🎛️ 위험도 레벨 시스템

| Level | 상태 | 크래시 임계값 | 알림 | 권장 조치 |
|-------|------|--------------|------|-----------|
| **0** | 정상 | < 20건 | 정기 리포트 | 계속 모니터링 |
| **1** | 주의 | 20-49건 | 모니터링 강화 | 모니터링 강화 |
| **2** | 경고 | 50-99건 | 원인 분석 시작 | 원인 분석 시작 |
| **3** | 위험 | 100-199건 | 긴급 대응팀 소집 | 핫픽스 준비 |
| **4** | 심각 | 200-499건 | 롤백 검토 | 롤백 검토 |
| **5** | 긴급 | ≥500건 | 즉시 롤백 | 즉시 롤백 |

### 📊 모니터링 단계

**집중 모니터링 (0-6시간)**
- 실행 빈도: 15분마다
- 목적: 초기 Critical 이슈 빠른 감지
- 알림: Level 2 이상 즉시 알림

**일반 모니터링 (6시간-7일)**  
- 실행 빈도: 1시간마다 (정시에만)
- 목적: 장기 안정성 확인
- 알림: Level 3 이상 즉시, Level 2는 6시간마다

**자동 완료 (7일 후)**
- 자동 정리: 상태에서 제거
- 완료 알림: 7일간 종합 분석

### 🚀 사용 방법

#### 새 릴리즈 모니터링 시작

**GitHub Actions (추천)**
```bash
# GitHub Repository → Actions → "Release Monitoring" → "Run workflow"
# 입력 정보:
# - 실행할 작업: start_monitoring  
# - 릴리즈 버전: 4.66.0
# - 릴리즈 시작 시간: 2025-01-27 14:00 (KST, 비워두면 현재 시간)
# - 모니터링 기간: 168 (시간 단위, 기본 7일)
```

**CLI 사용**
```bash
gh workflow run release_monitoring.yml \
  -f action=start_monitoring \
  -f release_version=4.66.0 \
  -f release_start_time="2025-01-27 14:00"
```

#### 현재 상태 확인
```bash
# GitHub Actions에서
# - 실행할 작업: status_check

# 또는 로컬에서
python release_monitoring/local_test.py --scenario status
```

#### 모니터링 취소
```bash
# GitHub Actions에서  
# - 실행할 작업: cancel_monitoring
# - 릴리즈 버전: 4.66.0
```

### 🧪 로컬 테스트

```bash
cd release_monitoring

# 설정 검증
python release_monitoring/local_test.py --scenario validate

# 샘플 데이터로 테스트  
python release_monitoring/local_test.py --scenario sample_data

# 신규 릴리즈 테스트
python release_monitoring/local_test.py --scenario new_release --version test-1.2.3

# 기존 모니터링 시뮬레이션
python release_monitoring/local_test.py --scenario monitoring

# 전체 테스트 스위트
python release_monitoring/local_test.py --scenario full_test

# 현재 상태 확인
python release_monitoring/local_test.py --scenario status

# 데이터 정리
python release_monitoring/local_test.py --scenario clear_data
```

### 📱 알림 예시

**Level 4 긴급 알림**
```
🚨 4.66.0 모니터링 알림

📱 버전: 4.66.0
📊 분석기간: 릴리즈 후 3.2시간  
⚠️ 위험도: Level 4 (심각)
🌍 환경: Production

📈 레벨별 상세 현황:
📊 크래시: Level 4 - 256건 (심각)
💀 Fatal: Level 3 - 89건 (위험)
👥 사용자: Level 3 - 124명 (위험)

🔥 주요 이슈:
1. 🔴 OutOfMemoryError - 98건, 영향: 67명
2. 🔴 NullPointerException - 76건, 영향: 45명

💡 권장 조치:
• 🚨 롤백 검토 및 준비
• 📞 핵심 개발팀 긴급 소집
• 🔍 상위 크래시 이슈 우선 분석
```

**Level 1 요약 리포트**
```
📊 4.66.0 모니터링 리포트

📅 릴리즈 후 12.5시간 | 🌍 Production | 상태: ✅ 주의

총 크래시 발생: 34건
Fatal 크래시: 12건  
영향 사용자: 28명
크래시 이슈 종류: 8개

🎯 다음 체크: 1시간 후 (일반 모니터링)
```

### 🔧 고급 설정

```bash
# 릴리즈 모니터링 전용 환경변수 (.env)
TEST_RELEASE_VERSION=test-1.0.0         # 테스트용 릴리즈 버전
TEST_RELEASE_START_TIME=2025-01-27 14:00 # 테스트용 시작 시간 (KST)
TEST_MONITORING_DURATION=168            # 테스트용 모니터링 기간 (시간)

# 모니터링 설정 (release_monitoring/config.py)
MONITORING_PERIODS = {
    'intensive_hours': 6,        # 집중 모니터링 기간
    'total_days': 7,            # 전체 모니터링 기간  
    'check_interval': 15,       # 체크 간격 (분)
    'analysis_window_hours': 24, # 분석 윈도우 크기
}

# 레벨링 임계값 (release_monitoring/config.py)
CRASH_ALERT_LEVELS = {
    1: {'threshold': 20, 'status': '주의'},
    2: {'threshold': 50, 'status': '경고'},
    3: {'threshold': 100, 'status': '위험'},
    4: {'threshold': 200, 'status': '심각'},
    5: {'threshold': 500, 'status': '긴급'}
}
```

---

## 🔍 문제 해결

### 일반적인 문제들

#### 1. Sentry 연결 실패
```bash
# 토큰 및 설정 확인
python release_monitoring/local_test.py --scenario validate

# 수동 연결 테스트 (릴리즈 모니터링)
python -c "from release_monitoring.release_analyzer import test_sentry_connection; test_sentry_connection()"
```

#### 2. Slack 전송 실패
```bash
# Webhook URL 테스트
curl -X POST -H 'Content-type: application/json' \
  --data '{"text":"테스트 메시지"}' \
  YOUR_SLACK_WEBHOOK_URL

# 일간 리포트 테스트 모드
TEST_MODE=true python3 daily_crash_report.py

# 주간 리포트 테스트 모드  
TEST_MODE=true python3 weekly_crash_report.py
```

#### 3. GitHub Actions 실행 실패
```bash
# Secrets 설정 확인
gh secret list

# 로컬에서 동일 환경 재현
export SENTRY_AUTH_TOKEN=your_token
export SENTRY_ORG_SLUG=your_org
# ... 기타 환경변수 설정

# 각 시스템별 테스트
python3 daily_crash_report.py
python3 weekly_crash_report.py  
python release_monitoring/release_monitor.py
```

#### 4. 데이터 정확성 문제
```bash
# 일간 리포트: 특정 날짜 테스트
TARGET_DATE=2025-01-26 TEST_MODE=true python3 daily_crash_report.py

# 주간 리포트: 특정 주차 테스트
TARGET_WEEK_START=2025-01-20 TEST_MODE=true python3 weekly_crash_report.py

# 릴리즈 모니터링: 디버그 모드
python release_monitoring/local_test.py --scenario new_release --test-mode
```

### 환경별 설정 확인

#### Android 팀 설정
```bash
SENTRY_ORG_SLUG=your-company
SENTRY_PROJECT_SLUG=android-app
SENTRY_PROJECT_ID=1234567
SENTRY_ENVIRONMENT=Production
```

#### iOS 팀 설정  
```bash
SENTRY_ORG_SLUG=your-company
SENTRY_PROJECT_SLUG=ios-app
SENTRY_PROJECT_ID=7654321
SENTRY_ENVIRONMENT=Production
```

### 디버깅 도구

#### 상세 로그 활성화
```bash
# 모든 시스템에 공통 적용
TEST_MODE=true                    # Slack 전송 비활성화, 상세 로그
DEBUG_OUTPUT=true                 # 디버그 파일 생성 (일간/주간 리포트)
CONSISTENCY_MODE=true             # 데이터 정확성 향상 (주간 리포트)
```

#### 상태 파일 확인
```bash
# 릴리즈 모니터링 상태 확인
cat release_monitoring/monitoring_state.json

# 디버그 출력 확인 (일간/주간 리포트)  
ls debug_output/
cat debug_output/crash_free_response_*.json
```

---

## 📚 API 참조

### 일간/주간 리포트 공통 함수

```python
# daily_crash_report.py / weekly_crash_report.py

# 이슈 수집
collect_issues_for_date(start_time: datetime, end_time: datetime) -> List[Dict]

# 크래시 통계 계산
calculate_crash_stats_for_date(issues: List[Dict], start_time: datetime, end_time: datetime) -> int

# Crash-Free Rate 조회  
get_crash_free_sessions() -> str
get_weekly_crash_free_rate() -> str

# Slack 메시지 전송
send_to_slack(message: Dict) -> bool
```

### 릴리즈 모니터링 전용 함수

```python
# release_monitoring/monitoring_state.py
add_monitoring_release(release_data: Dict) -> bool
get_active_monitoring_releases() -> List[Dict]
get_monitoring_phase(release: Dict) -> str
cleanup_completed_releases() -> int

# release_monitoring/release_analyzer.py
analyze_release_impact(release: Dict) -> Dict
test_sentry_connection() -> bool

# release_monitoring/alert_sender.py
send_level_alert(analysis_result: Dict) -> bool
send_summary_report(analysis_result: Dict) -> bool
send_completion_notice(version: str, stats: Dict) -> bool
```

## 📊 시스템 통합 활용 가이드

### 팀별 활용 시나리오

**📅 매일 아침 (일간 리포트 확인)**
1. Slack에서 일간 리포트 확인
2. 전날 대비 급증한 이슈가 있다면 우선순위 조정
3. Top 5 이슈 중 신규 발생 이슈 분석

**📊 매주 월요일 (주간 리포트 검토)**
1. 주간 트렌드와 이슈 생명주기 분석
2. 스프린트 계획에 악화/신규 이슈 반영  
3. 개선/해결된 이슈로 팀 성과 공유

**🚀 릴리즈 배포 시**
1. 배포 완료 후 릴리즈 모니터링 즉시 시작
2. 첫 6시간 집중 모니터링으로 Critical 이슈 조기 감지
3. Level 4-5 알림 시 롤백 여부 신속 판단

### 크로스 플랫폼 운영

**Android 팀**
```bash
SENTRY_PROJECT_SLUG=android-app
# 3개 시스템 모두 동일한 설정으로 운영
```

**iOS 팀**  
```bash
SENTRY_PROJECT_SLUG=ios-app  
# 환경변수만 변경하여 즉시 적용 가능
```

### 알림 채널 분리 권장

```bash
# Slack 채널 구성 예시
#dev-daily-crash      # 일간 리포트 (Level 0-2)
#dev-weekly-summary    # 주간 리포트  
#dev-release-monitor   # 릴리즈 모니터링 (Level 0-2)
#dev-urgent           # 긴급 알림 (Level 3-5)
```

---



