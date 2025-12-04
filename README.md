# Sentry AI Assistant

Sentry 에러 이슈를 AI로 분석하고 리포트를 생성하는 사내용 도구입니다.

## 📌 주요 기능

- **Sentry Webhook 수신**: 실시간으로 Sentry 이슈를 수신하고 저장
- **중요 이슈 알림**: 중요도 기준에 따라 Slack으로 자동 알림 전송
- **AI 분석 연동**: 외부 분석 서버와 연동하여 이슈 원인 분석
- **리포트 생성**: 기간/버전별 크래시 리포트 자동 생성
- **Streamlit UI**: 내부용 관리 대시보드

## 🛠️ 기술 스택

- **Backend**: FastAPI + Uvicorn
- **Database**: SQLite + SQLAlchemy ORM
- **UI**: Streamlit
- **HTTP Client**: httpx

## 📁 프로젝트 구조

```
sentry-ai-assistant/
├── app/
│   ├── main.py              # FastAPI entrypoint
│   ├── api/
│   │   ├── issues.py        # /api/issues 엔드포인트
│   │   ├── reports.py       # /api/reports 엔드포인트
│   │   └── webhook.py       # /webhook/sentry
│   ├── services/
│   │   ├── analysis_client.py   # 분석 서버 HTTP 클라이언트
│   │   ├── slack_client.py      # Slack Webhook 클라이언트
│   │   ├── issue_service.py     # Issue 비즈니스 로직
│   │   ├── report_service.py    # Report 비즈니스 로직
│   │   └── sentry_mapper.py     # Sentry payload 변환
│   └── db/
│       ├── session.py       # SQLite 연결/세션
│       ├── models.py        # ORM 모델
│       └── init_db.py       # 테이블 생성
├── ui/
│   └── streamlit_app.py     # Streamlit 대시보드
├── config/
│   └── settings.py          # 환경변수/설정
├── .env_template            # 환경변수 템플릿
├── requirements.txt
└── README.md
```

## 🚀 시작하기

### 1. 환경 설정

```bash
# 프로젝트 디렉토리로 이동
cd sentry-ai-assistant

# 가상환경 생성 (선택사항)
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 의존성 설치
pip install -r requirements.txt

# 환경변수 설정
cp .env_template .env
# .env 파일을 열어 필요한 값들을 입력하세요
```

### 2. FastAPI 서버 실행

```bash
# 개발 모드 (자동 리로드)
uvicorn app.main:app --reload --port 8000

# 또는 직접 실행
python -m app.main
```

서버가 시작되면:
- API 문서: http://localhost:8000/docs
- Health check: http://localhost:8000/health

### 3. Streamlit UI 실행

```bash
# 별도 터미널에서 실행
streamlit run ui/streamlit_app.py --server.port 8501
```

UI 접속: http://localhost:8501

## 📡 API 엔드포인트

### Health Check
- `GET /health` - 서버 상태 확인

### Webhook
- `POST /webhook/sentry` - Sentry Webhook 수신

### Issues
- `GET /api/issues` - 이슈 목록 조회
- `GET /api/issues/{id}` - 이슈 상세 조회
- `POST /api/issues/{id}/trigger-analysis` - AI 분석 트리거
- `POST /api/issues/manual-analysis` - 수동 분석 요청
- `GET /api/issues/{id}/analysis-status` - 분석 상태 조회

### Reports
- `GET /api/reports` - 리포트 목록 조회
- `POST /api/reports` - 리포트 생성
- `GET /api/reports/{id}` - 리포트 상세 조회
- `POST /api/reports/{id}/refresh` - 리포트 상태 새로고침

## ⚙️ 환경변수

| 변수명 | 설명 | 기본값 |
|--------|------|--------|
| `SENTRY_AUTH_TOKEN` | Sentry API 인증 토큰 | - |
| `SENTRY_ORG_SLUG` | Sentry 조직 슬러그 | - |
| `ANDROID_PROJECT_SLUG` | Android 프로젝트 슬러그 | - |
| `ANDROID_PROJECT_ID` | Android 프로젝트 ID | - |
| `ANDROID_SENTRY_ENVIRONMENT` | Android 환경 | production |
| `IOS_PROJECT_SLUG` | iOS 프로젝트 슬러그 | - |
| `IOS_PROJECT_ID` | iOS 프로젝트 ID | - |
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook URL | - |
| `ANALYSIS_SERVER_BASE_URL` | 분석 서버 URL | http://localhost:9000 |
| `DATABASE_URL` | 데이터베이스 URL | sqlite:///./sentry_ai.db |
| `APP_ENV` | 환경 (development/production) | development |
| `TEST_MODE` | 테스트 모드 | true |

## 🔗 외부 분석 서버 API

이 프로젝트는 별도의 AI 분석 서버와 통신합니다. 분석 서버는 다음 API를 제공해야 합니다:

### Issue 분석
- `POST /analysis/issue` - 이슈 분석 요청
- `GET /analysis/issue/{issueId}` - 분석 결과 조회

### Report 생성
- `POST /analysis/report` - 리포트 생성 요청
- `GET /analysis/report/{reportId}` - 리포트 결과 조회

자세한 API 스펙은 요구사항 문서를 참조하세요.

## 🗄️ 데이터베이스 스키마

### issues
- Sentry 이슈 정보 저장
- 필드: id, sentry_issue_id, title, level, event_count, user_count, release, environment, status, etc.

### issue_analysis
- AI 분석 결과 저장
- 필드: id, issue_id (FK), priority_score, root_cause, cause_type, solution, etc.

### reports
- 크래시 리포트 저장
- 필드: id, report_id, from_date, to_date, status, summary, insights, etc.

### alert_logs
- 알림 발송 기록
- 필드: id, issue_id (FK), alerted_at, alert_type, etc.

## 📝 개발 가이드

### 새로운 API 추가
1. `app/api/` 디렉토리에 라우터 파일 생성
2. `app/main.py`에서 라우터 등록
3. 필요시 `app/services/`에 비즈니스 로직 추가

### 데이터베이스 모델 수정
1. `app/db/models.py`에서 모델 수정
2. 기존 데이터가 있다면 마이그레이션 필요 (수동 또는 Alembic 사용)

## 📜 라이선스

Internal use only.
