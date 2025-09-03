# Sentry 일간 요약 봇 (REST API + Slack + AI 코멘트)

어제/그저께(한국시간 KST 기준)의 크래시 요약을 Sentry REST API로 수집하고, Slack Webhook으로 보기 좋게 전송합니다.
옵션으로 OpenAI를 사용해 “뉴스레터 스타일 1–2줄 요약 + (있으면) 액션 아이템”을 생성합니다.

---

## 주요 기능
- 요약 집계(어제 / 그저께)
- 이벤트 수(count), 고유 이슈 수, 영향 사용자 수
- Crash Free Sessions / Users (소수 둘째자리 절삭 표기)
- 상위 5개 이슈 + (AI가 생성한) 이슈별 코멘트/원인(들여쓰기 bullet)
- 신규 발생 이슈(firstSeen이 타겟 일자)
- 급증(서지) 이슈 고급 탐지
- DoD 배율 / Z-score / Robust(MAD) 기반
- 절대 건수 임계치 필터링 포함
- Slack 포맷팅 (한글, 이모지·볼드, 들여쓰기 bullet)
- AI 요약/조언(옵션): 뉴스레터형 한두 문장 + (필요 시) 오늘의 액션

---

## 사전 준비
- Python 3.9+
- Sentry API 토큰 (Org:Read, Project:Read 권한)
- Slack Incoming Webhook URL (선택)
- OpenAI API 키 (선택, AI 코멘트 사용 시)

---⸻

## 설치

### 1) 가상환경 권장
```
python3 -m venv .venv
source .venv/bin/activate               # Windows: .venv\Scripts\activate
```

### 2) 의존성 설치
```
pip install -r requirements.txt
```

이미 설치된 패키지에서 requirements.txt를 만들려면:
```
pip freeze > requirements.txt
```



---

## 환경 변수(.env)

프로젝트 루트에 .env 파일을 생성하세요.

```
# Sentry 인증/대상
SENTRY_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SENTRY_ORG_SLUG=your-org-slug
SENTRY_PROJECT_SLUG=your-project-slug
# 또는 SENTRY_PROJECT_ID 를 직접 지정해도 됨(둘 중 하나 필요)
# SENTRY_PROJECT_ID=1234567

# 필터링 환경(선택: e.g. Production)
SENTRY_ENVIRONMENT=Production

# Slack Webhook (선택: 전송 시 필요)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/XXX/YYY/ZZZ

# OpenAI (선택: AI 코멘트 사용 시)
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
```

### 참고
- SENTRY_PROJECT_SLUG 또는 SENTRY_PROJECT_ID 중 하나는 필수입니다.
- 환경이 없다면 전체(environment 필터 미적용)로 집계합니다.

---

## 실행

```
python sentry_crash_summary.py
```

- 표준 출력: 어제/그저께의 요약 JSON을 출력합니다.
- Slack 전송: SLACK_WEBHOOK_URL이 설정되어 있으면 포맷된 블록 메시지를 전송합니다.
- AI 코멘트: OPENAI_API_KEY가 설정되어 있으면 *:brain: AI 분석 코멘트* 섹션이 포함됩니다.

---

### 스케줄링(매일 오전 9시 KST)

리포트는 “어제 하루(00:00~23:59 KST)” 기준입니다. 서버가 한국시간대가 아닐 경우에도 코드 내부에서 KST로 변환합니다.

(예) macOS/Linux crontab -e

```
# 매일 09:00 (KST) 실행. 서버가 다른 TZ라면 환경에서 TZ=Asia/Seoul 지정 권장
0 9 * * * cd /path/to/project && /path/to/project/.venv/bin/python sentry_crash_summary.py >> log.txt 2>&1
```

---

## Slack 메시지 구성
```
헤더: Sentry 일간 리포트 — YYYY-MM-DD · <환경>
:memo: Summary
💥 이벤트, 🐞 이슈, 👥 영향 사용자 (전일 대비 🔺/🔻 증감)
🛡️ Crash Free 세션 / Crash Free 사용자 (절삭 표기)
:brain: AI 분석 코멘트
뉴스레터 스타일 1–2문장 (친근한 톤, 가벼운 농담/격려 허용)
(있으면) 오늘의 액션 불릿
:sports_medal: 상위 5개 이슈
• <이슈제목 링크> · 40건
◦ 원인/점검: ...
◦ 코멘트: ...
:new: 신규 발생 이슈
:chart_with_upwards_trend: 급증(서지) 이슈
```

---

## AI 코멘트 생성(옵션)
- generate_ai_advice(...)는 아래 원칙으로 작동합니다.
- 프롬프트에 맥락/용어 정의 + 전체 Summary JSON + 상위 5 이슈 간단 목록을 제공
- JSON만 반환하도록 강제 (코드블록 제거 처리)
- 액션은 유의미할 때만 포함 (없으면 빈 배열)
- per_issue_notes가 비어 있으면 최소 폴백으로 top1 이슈에 한 줄 붙일 수 있음

## 모델/톤 조정
- 기본: gpt-4o-mini, temperature=0.7
- 더 친근/다양한 톤: temperature=1.0 권장

---

## 임계값 및 탐지 로직

코드 상수(ENV 아님)로 조절합니다:
```
SURGE_MIN_COUNT = 30          # 급증 판정 최소 당일 이벤트 수(절대치)
SURGE_GROWTH_MULTIPLIER = 2.0 # DoD 2배↑
SURGE_Z_THRESHOLD = 2.0       # Z-score 임계
SURGE_MAD_THRESHOLD = 3.5     # Robust(MAD) 임계
SURGE_MIN_NEW_BURST = 15      # 7일 0 → 당일 폭발 간주 최소치
BASELINE_DAYS = 7             # 베이스라인(그저께 포함)
```

- 급증(서지) 이슈는 절대치(SURGE_MIN_COUNT) 미만이면 무조건 제외
- 추가 조건(DoD·Z·MAD·신규폭발) 중 하나라도 충족 시 후보로 포함

---

## 오류/트러블슈팅
- HTTP 4xx/5xx
- 토큰/슬러그/프로젝트 확인
- Sentry 권한(Org/Project Read) 확인
- API 레이트 리밋(429) 발생 시 재시도 정책 고려
- Invalid per_page value
- Discover API의 per_page는 1~100 제한 → 코드에선 페이지네이션 처리
- Crash Free 1.00%처럼 보이는 문제
- 코드에서 절삭(fmt_pct) 사용: int(pct*100)/100 → %.2f%%
- 상위 5 이슈 하위 코멘트 미노출
- build_slack_blocks_for_day(..., ai_data=ai_data) 인자 전달 확인
- per_issue_notes.issue_title이 상위5 제목과 완전 일치해야 매칭됨

---

## 예시 실행 출력(JSON, 콘솔)
```json
{
  "timezone": "Asia/Seoul (KST)",
  "2025-09-02": {
    "crash_events": 2543,
    "unique_issues": 19,
    "impacted_users": 917,
    "crash_free_sessions_pct": 0.9998,
    "crash_free_users_pct": 0.9985,
    "top_5_issues": [ ... ],
    "new_issues": [ ... ],
    "surge_issues": [ ... ],
    "window_utc": {"start":"2025-09-01T15:00:00Z","end":"2025-09-02T15:00:00Z"}
  },
  "2025-09-01": { ... }
}
```


---

## 디렉터리 구조(권장)
```
.
├── sentry_daily_crash_report.py   # 메인 스크립트(본 문서의 코드)
├── requirements.txt
├── .env                      # 로컬 비밀키 (커밋 금지)
└── README.md
```
