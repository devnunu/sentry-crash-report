# 📊 Sentry Daily & Weekly Reports

자동으로 Sentry 데이터를 수집하고 요약해 Slack으로 전송하는 **일간/주간 리포트 시스템**입니다.  
앱 안정성 현황을 매일 아침, 그리고 매주 월요일 한눈에 확인할 수 있어요! 🚀

---

## ✨ 주요 기능

### 🗓️ Daily Report (화~금 오전 9시)
- 💥 **전날 전체 이벤트 발생 건수** & 🐞 **유니크 이슈 개수** 요약
- 📈 **급증(서지) 이슈** 탐지 (DoD, Z-score, MAD 분석)
- 🆕 **신규 이슈 목록** 자동 추출
- 🧠 **AI 분석 코멘트** 제공 (중요 포인트 요약 + 친절한 코멘트)
- 🔗 **대시보드/필터된 이슈 페이지 바로가기 버튼** 탑재

---

### 📅 Weekly Report (월요일 오전 9시)
- 📝 **지난주 이벤트/이슈/사용자 주간 합계** & Crash Free 주간 평균
- 🏅 **Top 5 이벤트 이슈** (전주 대비 변화량 함께 표기)
- 📈 **급증 이슈** 상세 분석
- 📦 **최신 릴리즈에서 사라진 이슈 / 많이 감소한 이슈** 자동 리포트
- 🆕 **지난주 신규 이슈 목록** 제공

---

## ⚙️ 환경 변수 설정 (GitHub Secrets)

| Name                      | 설명                                      |
|---------------------------|-----------------------------------------|
| `SENTRY_AUTH_TOKEN`       | Sentry API Token                        |
| `SENTRY_ORG_SLUG`         | Sentry Organization Slug                |
| `ANDROID_PROJECT_ID`      | Android Sentry Project ID               |
| `ANDROID_PROJECT_SLUG`    | Android Sentry Project Slug             |
| `ANDROID_DASHBOARD_URL`   | Android Sentry 대시보드 URL             |
| `ANDROID_SLACK_WEBHOOK_URL` | Android 리포트 Slack Webhook URL    |
| `IOS_PROJECT_ID`          | iOS Sentry Project ID                   |
| `IOS_PROJECT_SLUG`        | iOS Sentry Project Slug                 |
| `IOS_DASHBOARD_URL`       | iOS Sentry 대시보드 URL                 |
| `IOS_SLACK_WEBHOOK_URL`   | iOS 리포트 Slack Webhook URL           |
| `OPENAI_API_KEY`          | OpenAI API Key (AI 코멘트 생성용)      |

---

## 🚀 GitHub Actions 워크플로우

워크플로우 파일: `.github/workflows/sentry-reports.yml`

- 매일 오전 9시 (화~금): **일간 리포트 실행**
- 매주 월요일 오전 9시: **주간 리포트 실행**
- `workflow_dispatch`로 **수동 실행 가능** (플랫폼/리포트 타입 지정 가능)

```yaml
on:
  schedule:
    - cron: '0 0 * * 1'   # 매주 월요일 9시 (KST)
    - cron: '0 0 * * 2-5' # 매일 화~금 9시 (KST)
  workflow_dispatch:
    inputs:
      which:
        description: '리포트 종류 (daily/weekly/both)'
        required: true
        default: 'both'
      platform:
        description: '플랫폼 (android/ios/both)'
        required: true
        default: 'both'
```

---

## 🧩 코드 구조

```
sentry_daily_crash_report.py   # 일간 리포트 생성 코드
sentry_weekly_crash_report.py  # 주간 리포트 생성 코드
```

- Sentry API를 통해 데이터를 수집
- 급증 탐지(Z-score, MAD), 신규 이슈 탐지, 최신 릴리즈 비교
- Slack 메시지 블록 생성 및 Webhook 전송
- OpenAI API로 AI 분석 코멘트 생성

---

## 🖼️ Slack 메시지 예시

```
📌 Daily Report

💥 총 이벤트 발생 건수: 65,904건 → 전일 대비 🔻37,981건 (-36.6%)
🐞 유니크 이슈 개수: 49개 → 전일 대비 🔺8개 (+19.5%)

📈 급증 이슈
• UnknownHostException... · 191건
  ↳ 전일 0건 → 어제 191건으로 급증. 최근 7일 평균 5.3건 대비 급상승.

🧠 AI 분석 코멘트
> 오늘은 큰 에러가 줄었지만 특정 API 호출 실패가 폭증했어요. API 쪽 네트워크 이슈 점검 필요!
```

---

```
📌 Weekly Report

💥 총 이벤트 발생 건수: 120,000건 → 전주 대비 🔻20,000건 (-14.2%)
📦 최신 릴리즈에서 사라진 이슈
• [Crash on Login] — 전 7일 50건 → 후 7일 0건 (Resolved)

📈 급증 이슈
• PaymentTimeoutException · 130건
  ↳ 전주 30건 → 이번주 130건. 중앙값 대비 이상치로 판정.
```

---

## 💡 사용 팁
	•	매일 아침 슬랙 리포트로 앱 안정성을 체크하세요! ☕️
	•	최신 릴리즈에 반영된 개선 사항도 자동으로 확인 가능 💪
	•	workflow_dispatch로 임의 날짜 범위나 플랫폼만 따로 리포트 가능 🎛️

---

이제 매일, 매주 버그 현황을 빠르고 간편하게 확인해보세요!