import { differenceInHours } from 'date-fns'

export interface ScheduleConfig {
  monitorId: string
  platform: string
  baseRelease: string
  startedAt: string
  shouldExecute: boolean
  interval: '30m' | '1h'
  reason: string
}

export class SchedulerService {
  
  /**
   * 모니터의 실행 주기를 결정합니다
   * - 모든 기간: 1시간 간격으로 통일
   */
  static getExecutionInterval(startedAt: string): '30m' | '1h' {
    // 모든 기간 1시간 간격으로 통일
    return '1h'
  }

  /**
   * 테스트 모드에서 커스텀 간격으로 실행 여부를 판단합니다
   */
  static shouldExecuteWithCustomInterval(
    customIntervalMinutes: number,
    lastExecutedAt?: string | null
  ): boolean {
    // 처음 실행이라면 바로 실행
    if (!lastExecutedAt) {
      return true
    }

    const now = new Date()
    const lastExecuted = new Date(lastExecutedAt)
    const minutesElapsed = Math.floor((now.getTime() - lastExecuted.getTime()) / (1000 * 60))

    // 실행 시간을 고려하여 1분 여유를 둠
    const requiredInterval = Math.max(1, customIntervalMinutes - 1)
    return minutesElapsed >= requiredInterval
  }

  /**
   * 현재 시점에서 모니터가 실행되어야 하는지 판단합니다
   */
  static shouldExecuteNow(
    startedAt: string,
    lastExecutedAt?: string | null
  ): boolean {
    const now = new Date()
    const interval = this.getExecutionInterval(startedAt)
    
    // 처음 실행이라면 바로 실행
    if (!lastExecutedAt) {
      return true
    }
    
    const lastExecuted = new Date(lastExecutedAt)
    const minutesElapsed = Math.floor((now.getTime() - lastExecuted.getTime()) / (1000 * 60))

    // 1시간 간격으로 통일 (QStash cron이 정각에 실행되므로 59분 이상이면 허용)
    const requiredInterval = 59

    return minutesElapsed >= requiredInterval
  }
  
  /**
   * 모니터의 현재 스케줄 상태를 분석합니다
   */
  static analyzeSchedule(
    monitorId: string,
    platform: string,
    baseRelease: string,
    startedAt: string,
    lastExecutedAt?: string | null
  ): ScheduleConfig {
    const interval = this.getExecutionInterval(startedAt)
    const shouldExecute = this.shouldExecuteNow(startedAt, lastExecutedAt)
    
    let reason = ''
    if (!lastExecutedAt) {
      reason = '첫 실행'
    } else {
      const hoursElapsed = differenceInHours(new Date(), new Date(startedAt))
      const minutesSinceLastRun = lastExecutedAt 
        ? Math.floor((Date.now() - new Date(lastExecutedAt).getTime()) / (1000 * 60))
        : 0
      
      if (hoursElapsed < 24) {
        reason = `초기 24시간 (${interval} 간격, 마지막 실행 후 ${minutesSinceLastRun}분 경과)`
      } else {
        reason = `일반 모드 (${interval} 간격, 마지막 실행 후 ${minutesSinceLastRun}분 경과)`
      }
    }
    
    return {
      monitorId,
      platform,
      baseRelease,
      startedAt,
      shouldExecute,
      interval,
      reason
    }
  }
  
  /**
   * 다음 실행 시점을 계산합니다
   */
  static getNextExecutionTime(
    startedAt: string,
    lastExecutedAt?: string | null
  ): Date {
    const interval = this.getExecutionInterval(startedAt)
    const base = lastExecutedAt ? new Date(lastExecutedAt) : new Date()
    const minutesToAdd = 60
    
    return new Date(base.getTime() + minutesToAdd * 60 * 1000)
  }
}

// 스케줄러 상태를 추적하기 위한 헬퍼 함수들
export function formatScheduleInfo(config: ScheduleConfig): string {
  const status = config.shouldExecute ? '✅ 실행 예정' : '⏳ 대기 중'
  return `[${config.platform}:${config.baseRelease}] ${status} - ${config.reason}`
}

export function getScheduleSummary(configs: ScheduleConfig[]) {
  const total = configs.length
  const toExecute = configs.filter(c => c.shouldExecute).length
  const in30m = configs.filter(c => c.interval === '30m').length
  const in1h = configs.filter(c => c.interval === '1h').length
  
  return {
    total,
    toExecute,
    waiting: total - toExecute,
    intervals: {
      '30m': in30m,
      '1h': in1h
    }
  }
}