# 🚀 Enhanced Sentry AI Monitoring System

## 📋 Overview

이 시스템은 SentryMCP의 고급 분석 기능을 monitor 프로젝트에 통합하여 Vercel에서 실행 가능한 심플한 버전으로 구현한 것입니다.

### ✨ 주요 기능

1. **🧠 고도화된 AI 분석**: SentryMCP의 20년차 전문가 수준 분석 프롬프트 적용
2. **⚡ 실시간 웹훅 처리**: Sentry 이슈 발생 즉시 자동 분석
3. **🔍 자동 모니터링**: 5분마다 새로운 이슈 자동 탐지 및 분석  
4. **📊 모니터링 대시보드**: 실시간 상태 및 통계 확인
5. **🚨 알림 시스템**: Slack 및 이메일 자동 알림
6. **📈 분석 결과 추적**: 모든 분석 결과 데이터베이스 저장

## 🛠️ 설정 가이드

### 1. 데이터베이스 설정

Supabase SQL 에디터에서 `database_setup.sql` 파일을 실행하세요:

```sql
-- database_setup.sql의 내용을 Supabase에서 실행
```

### 2. 환경 변수 설정

`.env.local` 파일에 다음 환경 변수를 추가하세요:

```bash
# 필수 환경 변수
SENTRY_AUTH_TOKEN=sntryu_xxxxxxxxxxxxx
SENTRY_ORG_SLUG=finda-b2c
SENTRY_PROJECT_SLUG=finda-ios
SENTRY_BASE_URL=https://sentry.io/api/0
OPENAI_API_KEY=sk-xxxxxxxxxxxxx
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxxxxxxxxxxxx

# 웹훅 설정 (선택사항)
SENTRY_WEBHOOK_SECRET=your_webhook_secret_key

# 자동화 스케줄러 (선택사항)  
SCHEDULER_SECRET=your_scheduler_secret

# 알림 설정 (선택사항)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx/xxx/xxx
SLACK_CHANNEL=#sentry-alerts  
SLACK_MENTION_USERS=U1234567,U2345678

# 알림 레벨 설정 (기본값)
NOTIFY_CRITICAL=true
NOTIFY_HIGH=true
NOTIFY_MEDIUM=false
NOTIFY_LOW=false
```

### 3. Sentry 웹훅 설정

1. Sentry 대시보드 → Settings → Developer Settings → Webhooks
2. "Create New Webhook" 클릭
3. URL: `https://your-vercel-app.vercel.app/api/sentry/webhook`
4. Secret: `.env.local`의 `SENTRY_WEBHOOK_SECRET` 값 입력
5. Events: `issue.created`, `issue.resolved`, `issue.assigned` 선택
6. Projects: `finda-ios` 선택

### 4. 자동화 설정

#### Option A: Vercel Cron (권장)

`vercel.json` 파일 생성:

```json
{
  "crons": [
    {
      "path": "/api/sentry/schedule",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

#### Option B: GitHub Actions

`.github/workflows/monitor.yml` 파일 생성:

```yaml
name: Sentry Monitor
on:
  schedule:
    - cron: '*/5 * * * *'  # 5분마다 실행
  workflow_dispatch:  # 수동 실행 가능

jobs:
  monitor:
    runs-on: ubuntu-latest
    steps:
      - name: Call Sentry Monitor
        run: |
          curl -X POST "https://your-app.vercel.app/api/sentry/schedule" \
            -H "Authorization: Bearer ${{ secrets.SCHEDULER_SECRET }}" \
            -H "Content-Type: application/json"
```

#### Option C: 외부 크론 서비스

- cron-job.org
- EasyCron
- AWS EventBridge

URL: `https://your-app.vercel.app/api/sentry/schedule`
Method: POST
Headers: `Authorization: Bearer YOUR_SCHEDULER_SECRET`
Schedule: `*/5 * * * *`

## 🎯 사용법

### 실시간 모니터링 대시보드

1. `http://localhost:3000/monitor/real-time` 접속
2. 모니터링 상태, 통계, 웹훅 로그 확인
3. "수동 체크" 버튼으로 즉시 모니터링 실행

### Sentry 이슈 분석

1. `http://localhost:3000/monitor/sentry-analysis` 접속  
2. Sentry 이슈 ID 입력 (예: `FINDA-IOS-3RR` 또는 `4567891234`)
3. AI가 20년차 전문가 수준의 상세 분석 제공

### API 엔드포인트

- `GET /api/sentry/monitor` - 모니터링 상태 조회
- `POST /api/sentry/monitor` - 수동 모니터링 실행
- `POST /api/sentry/webhook` - Sentry 웹훅 처리
- `POST /api/sentry/analyze` - 개별 이슈 분석
- `POST /api/sentry/schedule` - 스케줄된 모니터링 실행
- `GET /api/sentry/schedule` - 스케줄러 설정 가이드

## 🔧 고급 설정

### 알림 커스터마이징

`src/lib/notifications.ts`에서 알림 로직 수정 가능:

- Slack 메시지 포맷 변경
- 이메일 템플릿 수정  
- 알림 조건 변경
- 추가 알림 채널 구현

### AI 분석 프롬프트 수정

`src/lib/ai-analysis.ts`의 `buildAnalysisPrompt` 메서드에서:

- 전문가 경험 년수 변경
- 분석 카테고리 추가/수정
- 응답 형식 커스터마이징
- 핀테크 특화 고려사항 수정

### 모니터링 설정 변경

데이터베이스의 `monitoring_config` 테이블에서:

- 체크 간격 변경
- 대상 프로젝트 추가/제거  
- 최소 이슈 레벨 변경
- 최대 처리 이슈 수 조정

## 📊 모니터링 및 로그

### 데이터베이스 테이블

- `sentry_issue_analyses` - AI 분석 결과 저장
- `monitoring_logs` - 자동 모니터링 로그
- `webhook_logs` - 웹훅 처리 로그
- `notification_logs` - 알림 발송 로그
- `monitoring_config` - 모니터링 설정

### 뷰 및 통계

- `monitoring_statistics` - 모니터링 통계 뷰
- `webhook_statistics` - 웹훅 통계 뷰

## 🚨 트러블슈팅

### 일반적인 문제

1. **웹훅이 수신되지 않음**
   - Sentry 웹훅 URL 확인
   - `SENTRY_WEBHOOK_SECRET` 환경 변수 확인
   - Vercel 함수 로그 확인

2. **AI 분석 실패**
   - `OPENAI_API_KEY` 유효성 확인
   - API 사용량 한도 확인
   - Sentry API 권한 확인

3. **자동 모니터링 실행 안됨**
   - Vercel Cron 설정 확인
   - 환경 변수 설정 확인
   - 함수 실행 로그 확인

4. **알림이 전송되지 않음**
   - Slack 웹훅 URL 확인
   - 알림 레벨 설정 확인
   - 네트워크 연결 확인

### 로그 확인 방법

1. **Vercel 로그**: Vercel 대시보드 → Functions → 실시간 로그
2. **데이터베이스 로그**: Supabase 대시보드 → Table Editor
3. **브라우저 콘솔**: 개발자 도구 → Console

## 🔄 SentryMCP와의 차이점

| 기능 | SentryMCP | Enhanced Monitor |
|------|-----------|------------------|
| 플랫폼 | Swift/Vapor | Next.js/Vercel |
| 배포 | Docker/AWS | Serverless |
| 실시간 처리 | SSE | 웹훅 + 폴링 |
| AI 분석 | Claude Code | OpenAI GPT-4 |
| 데이터베이스 | 내장 | Supabase |
| 웹 UI | 기본 | 고급 대시보드 |
| 설정 복잡도 | 높음 | 낮음 |

## 📈 향후 개선 사항

- [ ] SSE(Server-Sent Events) 실시간 스트리밍
- [ ] 더 정교한 이슈 필터링 및 그룹핑
- [ ] 커스텀 분석 템플릿
- [ ] 팀별/프로젝트별 알림 설정
- [ ] 대시보드 위젯 커스터마이징
- [ ] API 응답 캐싱 및 성능 최적화

## 🤝 기여하기

1. 이슈 리포트: GitHub Issues
2. 기능 요청: Discussion  
3. 코드 기여: Pull Request

---

**💡 Tip**: 처음 설정 후 `/monitor/real-time`에서 "수동 체크"를 실행하여 모든 것이 정상 작동하는지 확인하세요!