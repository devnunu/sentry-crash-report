import { createSentryService } from './sentry'
import { createSlackService } from './slack'
import { db } from './database'
import { SchedulerService } from './scheduler'
import type { MonitorSession, WindowAggregation, TopIssue } from './types'

export interface MonitorExecutionResult {
  monitorId: string
  platform: string
  baseRelease: string
  status: 'success' | 'error' | 'skipped'
  error?: string
  aggregation?: WindowAggregation
  windowStart?: Date
  windowEnd?: Date
  topIssues?: TopIssue[]
  slackSent?: boolean
  interval?: '30m' | '1h' | 'custom'
  customIntervalMinutes?: number
  totalAggregation?: WindowAggregation
}

export class MonitoringService {
  
  // 단일 모니터 실행
  async executeMonitor(monitor: MonitorSession, customIntervalMinutes?: number): Promise<MonitorExecutionResult> {
    const result: MonitorExecutionResult = {
      monitorId: monitor.id,
      platform: monitor.platform,
      baseRelease: monitor.base_release,
      status: 'success'
    }
    
    try {
      // 마지막 실행 시간 조회
      const lastHistory = await db.getLastMonitorHistory(monitor.id)

      // 테스트 모드인 경우 커스텀 간격 사용
      const isTestMode = monitor.is_test_mode && customIntervalMinutes
      let shouldExecute: boolean
      let interval: '30m' | '1h' | 'custom'

      if (isTestMode) {
        shouldExecute = SchedulerService.shouldExecuteWithCustomInterval(
          customIntervalMinutes!,
          lastHistory?.executed_at
        )
        interval = 'custom'
        console.log(`🧪 [테스트 모드] ${customIntervalMinutes}분 간격으로 실행 조건 확인: ${shouldExecute}`)
      } else {
        const scheduleConfig = SchedulerService.analyzeSchedule(
          monitor.id,
          monitor.platform,
          monitor.base_release,
          monitor.started_at,
          lastHistory?.executed_at
        )
        shouldExecute = scheduleConfig.shouldExecute
        interval = scheduleConfig.interval
      }

      result.interval = interval
      if (isTestMode) {
        result.customIntervalMinutes = customIntervalMinutes!
      }

      // 실행 조건 확인
      if (!shouldExecute) {
        result.status = 'skipped'
        return result
      }
      
      console.log(`🔍 [${monitor.platform}:${monitor.base_release}] 모니터링 실행 중...`)
      
      // 1. matched_release 확인 또는 매칭
      const platformSentryService = createSentryService(monitor.platform)

      let matchedRelease = monitor.matched_release
      if (!matchedRelease) {
        console.log(`🔍 [${monitor.platform}:${monitor.base_release}] 릴리즈 매칭 중...`)
        const foundRelease = await platformSentryService.matchFullRelease(monitor.base_release)
        
        if (!foundRelease) {
          throw new Error(`매칭되는 릴리즈를 찾을 수 없습니다: ${monitor.base_release}`)
        }
        
        matchedRelease = foundRelease
        
        // 데이터베이스 업데이트
        const updated = await db.updateMonitorSession(monitor.id, { matched_release: matchedRelease })
        monitor.matched_release = updated.matched_release
        monitor.metadata = updated.metadata
        console.log(`✅ [${monitor.platform}:${monitor.base_release}] 릴리즈 매칭 완료: ${matchedRelease}`)
      }
      monitor.matched_release = matchedRelease

      const metadata = (monitor.metadata ?? {}) as Record<string, unknown>
      let releaseStartIso = typeof metadata.release_started_at === 'string' ? metadata.release_started_at : undefined
      let releaseStart = releaseStartIso ? new Date(releaseStartIso) : undefined
      if (!releaseStart || Number.isNaN(releaseStart.getTime())) {
        const releaseCreatedAt = await platformSentryService.getReleaseCreatedAt(matchedRelease)
        releaseStart = releaseCreatedAt ?? new Date(monitor.started_at)
        releaseStartIso = releaseStart.toISOString()
        const newMetadata = {
          ...metadata,
          release_started_at: releaseStartIso
        }
        const updated = await db.updateMonitorSession(monitor.id, { metadata: newMetadata })
        monitor.metadata = updated.metadata
      }

      releaseStart = releaseStartIso ? new Date(releaseStartIso) : new Date(monitor.started_at)
      if (releaseStart > new Date()) {
        releaseStart = new Date(monitor.started_at)
      }

      // 2. 시간 윈도우 계산
      const intervalMinutes = isTestMode ? customIntervalMinutes! : (interval === '30m' ? 30 : 60)
      const windowEnd = new Date()
      if (releaseStart >= windowEnd) {
        releaseStart = new Date(windowEnd.getTime() - intervalMinutes * 60 * 1000)
      }
      const windowStart = lastHistory?.executed_at
        ? new Date(lastHistory.executed_at)
        : new Date(Date.now() - intervalMinutes * 60 * 1000)
      
      result.windowStart = windowStart
      result.windowEnd = windowEnd
      
      console.log(`📊 [${monitor.platform}:${monitor.base_release}] 집계 구간: ${windowStart.toISOString()} ~ ${windowEnd.toISOString()}`)
      
      // 3. Sentry 데이터 수집
      const [aggregation, topIssues] = await Promise.all([
        platformSentryService.getWindowAggregates(matchedRelease, windowStart, windowEnd),
        platformSentryService.getTopIssues(matchedRelease, windowStart, windowEnd, 5)
      ])
      const totalAggregation = await platformSentryService.getWindowAggregates(matchedRelease, releaseStart, windowEnd)
      
      result.aggregation = aggregation
      result.topIssues = topIssues
      result.totalAggregation = totalAggregation
      
      console.log(`📈 [${monitor.platform}:${monitor.base_release}] 집계 결과: Events=${aggregation.events}, Issues=${aggregation.issues}, Users=${aggregation.users}`)
      
      // 4. 델타 및 누적 계산
      const deltas: WindowAggregation = lastHistory 
        ? {
            events: aggregation.events - (lastHistory.events_count || 0),
            issues: aggregation.issues - (lastHistory.issues_count || 0),
            users: aggregation.users - (lastHistory.users_count || 0)
          }
        : { events: 0, issues: 0, users: 0 } // 첫 실행
      
      // 5. Slack 알림 전송
      let slackSent = false
      const platformSlackService = createSlackService(monitor.platform, monitor.is_test_mode || false)
      try {
        const actionUrls = platformSentryService.buildActionUrls(matchedRelease, windowStart, windowEnd)

        const cadenceLabel = interval === 'custom'
          ? `${customIntervalMinutes}분`
          : interval === '30m' ? '30분' : '1시간'

        await platformSlackService.sendMonitoringReport(
          monitor.platform,
          monitor.base_release,
          matchedRelease,
          windowStart,
          windowEnd,
          aggregation,
          deltas,
          totalAggregation,
          topIssues,
          actionUrls,
          cadenceLabel
        )

        slackSent = true
        console.log(`📤 [${monitor.platform}:${monitor.base_release}] Slack 알림 전송 완료`)
      } catch (slackError) {
        console.error(`📤 [${monitor.platform}:${monitor.base_release}] Slack 알림 전송 실패:`, slackError)
        // Slack 실패는 전체 실행 실패로 처리하지 않음
      }
      
      result.slackSent = slackSent
      
      // 6. 히스토리 저장
      await db.createMonitorHistory(
        monitor.id,
        windowStart,
        windowEnd,
        aggregation,
        topIssues,
        slackSent
      )
      
      console.log(`✅ [${monitor.platform}:${monitor.base_release}] 모니터링 실행 완료`)
      
    } catch (error) {
      result.status = 'error'
      result.error = error instanceof Error ? error.message : String(error)
      console.error(`❌ [${monitor.platform}:${monitor.base_release}] 모니터링 실행 실패:`, error)
    }
    
    return result
  }

  // 특정 모니터 실행 (테스트 모드용)
  async executeSpecificMonitor(monitorId: string, customIntervalMinutes?: number): Promise<{
    processedCount: number
    skippedCount: number
    errorCount: number
    results: MonitorExecutionResult[]
  }> {
    console.log(`🧪 특정 모니터 실행 시작: ${monitorId}`)

    const monitor = await db.getMonitorSession(monitorId)
    if (!monitor) {
      console.error(`❌ 모니터를 찾을 수 없습니다: ${monitorId}`)
      return {
        processedCount: 0,
        skippedCount: 0,
        errorCount: 1,
        results: [{
          monitorId,
          platform: 'unknown',
          baseRelease: 'unknown',
          status: 'error',
          error: '모니터를 찾을 수 없습니다'
        }]
      }
    }

    if (monitor.status !== 'active') {
      console.log(`⏸️ 모니터 ${monitor.id}는 활성 상태가 아닙니다 (${monitor.status}), 실행을 건너뜁니다.`)
      return {
        processedCount: 0,
        skippedCount: 1,
        errorCount: 0,
        results: [{
          monitorId: monitor.id,
          platform: monitor.platform,
          baseRelease: monitor.base_release,
          status: 'skipped',
          error: `모니터 상태가 ${monitor.status} 입니다`
        }]
      }
    }

    const result = await this.executeMonitor(monitor, customIntervalMinutes)

    const processedCount = result.status === 'success' ? 1 : 0
    const skippedCount = result.status === 'skipped' ? 1 : 0
    const errorCount = result.status === 'error' ? 1 : 0

    console.log(`📊 특정 모니터 실행 완료: ${processedCount}개 성공, ${skippedCount}개 스킵, ${errorCount}개 실패`)

    return {
      processedCount,
      skippedCount,
      errorCount,
      results: [result]
    }
  }

  // 모든 활성 모니터 실행
  async executeAllActiveMonitors(): Promise<{
    processedCount: number
    skippedCount: number
    errorCount: number
    results: MonitorExecutionResult[]
  }> {
    console.log('🚀 모든 활성 모니터 실행 시작')
    
    const activeMonitors = await db.getActiveMonitorSessions()
    console.log(`📋 활성 모니터 ${activeMonitors.length}개 발견`)
    
    if (activeMonitors.length === 0) {
      return {
        processedCount: 0,
        skippedCount: 0,
        errorCount: 0,
        results: []
      }
    }
    
    const results: MonitorExecutionResult[] = []
    
    // 순차 실행 (병렬 실행 시 Sentry API 제한에 걸릴 수 있음)
    for (const monitor of activeMonitors) {
      const result = await this.executeMonitor(monitor)
      results.push(result)
    }
    
    const processedCount = results.filter(r => r.status === 'success').length
    const skippedCount = results.filter(r => r.status === 'skipped').length
    const errorCount = results.filter(r => r.status === 'error').length
    
    console.log(`📊 실행 완료: ${processedCount}개 성공, ${skippedCount}개 스킵, ${errorCount}개 실패`)
    
    return {
      processedCount,
      skippedCount,
      errorCount,
      results
    }
  }
  
  // 모니터링 시작 시 Slack 알림
  async notifyMonitorStart(monitor: MonitorSession): Promise<void> {
    try {
      const platformSlackService = createSlackService(monitor.platform, monitor.is_test_mode || false)
      await platformSlackService.sendStartNotification(
        monitor.platform,
        monitor.base_release,
        monitor.id,
        new Date(monitor.expires_at),
        monitor.custom_interval_minutes ?? undefined,
        monitor.is_test_mode ?? false
      )
      console.log(`📤 [${monitor.platform}:${monitor.base_release}] 시작 알림 전송 완료`)
    } catch (error) {
      console.error(`📤 [${monitor.platform}:${monitor.base_release}] 시작 알림 전송 실패:`, error)
    }
  }
  
  // 모니터링 종료 시 Slack 알림
  async notifyMonitorStop(
    monitor: MonitorSession, 
    reason: 'manual' | 'expired'
  ): Promise<void> {
    try {
      const platformSlackService = createSlackService(monitor.platform, monitor.is_test_mode || false)
      await platformSlackService.sendStopNotification(
        monitor.platform,
        monitor.base_release,
        monitor.id,
        reason
      )
      console.log(`📤 [${monitor.platform}:${monitor.base_release}] 종료 알림 전송 완료`)
    } catch (error) {
      console.error(`📤 [${monitor.platform}:${monitor.base_release}] 종료 알림 전송 실패:`, error)
    }
  }
}

// 싱글톤 인스턴스
export const monitoringService = new MonitoringService()
