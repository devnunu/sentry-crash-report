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
  interval?: '30m' | '1h'
}

export class MonitoringService {
  
  // 단일 모니터 실행
  async executeMonitor(monitor: MonitorSession): Promise<MonitorExecutionResult> {
    const result: MonitorExecutionResult = {
      monitorId: monitor.id,
      platform: monitor.platform,
      baseRelease: monitor.base_release,
      status: 'success'
    }
    
    try {
      // 마지막 실행 시간 조회
      const lastHistory = await db.getLastMonitorHistory(monitor.id)
      
      // 스케줄 분석
      const scheduleConfig = SchedulerService.analyzeSchedule(
        monitor.id,
        monitor.platform,
        monitor.base_release,
        monitor.started_at,
        lastHistory?.executed_at
      )
      
      result.interval = scheduleConfig.interval
      
      // 실행 조건 확인
      if (!scheduleConfig.shouldExecute) {
        result.status = 'skipped'
        return result
      }
      
      console.log(`🔍 [${monitor.platform}:${monitor.base_release}] 모니터링 실행 중...`)
      
      // 1. matched_release 확인 또는 매칭
      let matchedRelease = monitor.matched_release
      if (!matchedRelease) {
        console.log(`🔍 [${monitor.platform}:${monitor.base_release}] 릴리즈 매칭 중...`)
        const platformSentryService = createSentryService(monitor.platform)
        const foundRelease = await platformSentryService.matchFullRelease(monitor.base_release)
        
        if (!foundRelease) {
          throw new Error(`매칭되는 릴리즈를 찾을 수 없습니다: ${monitor.base_release}`)
        }
        
        matchedRelease = foundRelease
        
        // 데이터베이스 업데이트
        await db.updateMonitorSession(monitor.id, { matched_release: matchedRelease })
        console.log(`✅ [${monitor.platform}:${monitor.base_release}] 릴리즈 매칭 완료: ${matchedRelease}`)
      }
      
      // 2. 시간 윈도우 계산
      const intervalMinutes = scheduleConfig.interval === '30m' ? 30 : 60
      const windowEnd = new Date()
      const windowStart = lastHistory?.executed_at 
        ? new Date(lastHistory.executed_at)
        : new Date(Date.now() - intervalMinutes * 60 * 1000)
      
      result.windowStart = windowStart
      result.windowEnd = windowEnd
      
      console.log(`📊 [${monitor.platform}:${monitor.base_release}] 집계 구간: ${windowStart.toISOString()} ~ ${windowEnd.toISOString()}`)
      
      // 3. Sentry 데이터 수집
      const platformSentryService = createSentryService(monitor.platform)
      const [aggregation, topIssues] = await Promise.all([
        platformSentryService.getWindowAggregates(matchedRelease, windowStart, windowEnd),
        platformSentryService.getTopIssues(matchedRelease, windowStart, windowEnd, 5)
      ])
      
      result.aggregation = aggregation
      result.topIssues = topIssues
      
      console.log(`📈 [${monitor.platform}:${monitor.base_release}] 집계 결과: Events=${aggregation.events}, Issues=${aggregation.issues}, Users=${aggregation.users}`)
      
      // 4. 델타 및 누적 계산
      const deltas: WindowAggregation = lastHistory 
        ? {
            events: aggregation.events - (lastHistory.events_count || 0),
            issues: aggregation.issues - (lastHistory.issues_count || 0),
            users: aggregation.users - (lastHistory.users_count || 0)
          }
        : { events: 0, issues: 0, users: 0 } // 첫 실행
      
      // 누적 데이터 계산
      const allHistory = await db.getMonitorHistory(monitor.id, 1000)
      const cumulative: WindowAggregation = allHistory.reduce(
        (acc, h) => ({
          events: acc.events + (h.events_count || 0),
          issues: acc.issues + (h.issues_count || 0),
          users: acc.users + (h.users_count || 0)
        }),
        aggregation // 현재 집계도 포함
      )
      
      // 5. Slack 알림 전송
      let slackSent = false
      const platformSlackService = createSlackService(monitor.platform)
      try {
        const actionUrls = platformSentryService.buildActionUrls(matchedRelease, windowStart, windowEnd)
        
        await platformSlackService.sendMonitoringReport(
          monitor.platform,
          monitor.base_release,
          matchedRelease,
          windowStart,
          windowEnd,
          aggregation,
          deltas,
          cumulative,
          topIssues,
          actionUrls,
          scheduleConfig.interval
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
      const platformSlackService = createSlackService(monitor.platform)
      await platformSlackService.sendStartNotification(
        monitor.platform,
        monitor.base_release,
        monitor.id,
        new Date(monitor.expires_at)
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
      const platformSlackService = createSlackService(monitor.platform)
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