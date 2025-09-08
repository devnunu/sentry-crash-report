// 개발 서버 시작시 실행되는 초기화 코드
import { devCronService } from './dev-cron'

export function initializeDevServices() {
  if (process.env.NODE_ENV !== 'development') {
    return false
  }

  console.log('🚀 Initializing development services...')
  
  // 개발용 cron 서비스 시작
  devCronService.start()
  
  console.log('✅ Development services initialized')
  return true
}

// 개발 서버 전용 상태 확인 API를 위한 헬퍼
export function getDevServicesStatus() {
  const cronStatus = devCronService.getStatus()
  
  return {
    initialized: cronStatus.isRunning, // cron 실행 상태를 초기화 상태로 사용
    cronService: cronStatus,
    environment: process.env.NODE_ENV
  }
}

// 자동 초기화 (필요시 호출)
export function ensureDevServicesStarted() {
  if (process.env.NODE_ENV !== 'development') {
    return false
  }

  const status = devCronService.getStatus()
  if (!status.isRunning) {
    console.log('🔧 Auto-starting development services...')
    return initializeDevServices()
  }
  
  return true
}