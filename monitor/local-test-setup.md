# 로컬 QStash 테스트 환경 구성

QStash는 로컬 환경(localhost, ::1)을 지원하지 않습니다. 로컬에서 테스트하는 방법들을 제공합니다.

## 방법 1: 로컬 모드 사용 (추천)

**설정 방법:**

1. `.env.local` 파일에 다음 설정 추가:
```env
QSTASH_LOCAL_MODE=true
```

2. 개발 서버 재시작:
```bash
npm run dev
```

**특징:**
- QStash API 없이 로컬에서 스케줄링 테스트 가능
- `setInterval`을 사용한 간단한 cron 구현
- 즉시 실행 + 주기적 실행
- 로그에서 `[QStash-Local]` 표시로 구분
- 서명 검증 생략 (로컬 테스트용)

**지원하는 cron 형식:**
- `*/5 * * * *` - 5분마다 실행
- `*/10 * * * *` - 10분마다 실행
- 기본값: 5분 간격

## 방법 2: ngrok 사용

1. ngrok 설치:
```bash
# Homebrew를 사용하여 설치
brew install ngrok

# 또는 직접 다운로드
# https://ngrok.com/download
```

2. ngrok으로 로컬 서버 노출:
```bash
# Next.js 개발 서버가 3000번 포트에서 실행 중일 때
ngrok http 3000
```

3. ngrok이 제공하는 HTTPS URL을 `.env.local`에 추가:
```env
NEXT_PUBLIC_BASE_URL=https://your-ngrok-url.ngrok.io
QSTASH_LOCAL_MODE=false
```

4. QStash 환경 변수 설정:
```env
QSTASH_TOKEN=your_qstash_token
QSTASH_CURRENT_SIGNING_KEY=your_signing_key
QSTASH_NEXT_SIGNING_KEY=your_next_signing_key
```

## 테스트 방법

1. 브라우저에서 `http://localhost:3000/monitor/dashboard` 접속
2. "모니터링 시작" 버튼 클릭
3. 콘솔에서 로그 확인:
   - 로컬 모드: `[QStash-Local] Job scheduled successfully`
   - 클라우드 모드: `[QStash] Job scheduled successfully`

## 프로덕션 배포 시

프로덕션에서는 반드시 다음 설정을 사용하세요:
```env
QSTASH_LOCAL_MODE=false
QSTASH_TOKEN=your_production_token
QSTASH_CURRENT_SIGNING_KEY=your_production_signing_key
```