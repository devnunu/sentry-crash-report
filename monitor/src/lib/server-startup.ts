// 로컬 개발용 cron은 비활성화되었습니다. (QStash 사용)
export function initializeDevServices() {
  if (process.env.NODE_ENV === 'development') {
    console.log('ℹ️ Dev cron is disabled in local environment. Using QStash schedules only.')
  }
  return false
}

// 개발 서버 전용 상태 확인 API를 위한 헬퍼 (항상 비활성화로 리턴)
export function getDevServicesStatus() {
  return {
    initialized: false,
    cronService: { isRunning: false, tasksCount: 0, environment: process.env.NODE_ENV },
    environment: process.env.NODE_ENV
  }
}

// 자동 초기화 (비활성화)
export function ensureDevServicesStarted() {
  return false
}
