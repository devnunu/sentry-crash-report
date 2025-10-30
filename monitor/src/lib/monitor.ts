import { createSentryService } from './sentry'
import { createSlackService } from './slack'
import { db } from './database'
import { SchedulerService } from './scheduler'
import type { MonitorSession, WindowAggregation, TopIssue, VersionMonitorSnapshot } from './types'

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

  // 누적 데이터 수집 (버전 모니터링용)
  async collectCumulativeData(
    monitor: MonitorSession,
    sentryService: ReturnType<typeof createSentryService>,
    releaseStart: Date,
    currentTime: Date
  ): Promise<VersionMonitorSnapshot> {
    const matchedRelease = monitor.matched_release!

    // 마지막 체크포인트 조회 (checkpoint 구현 후)
    const lastHistory = await db.getLastMonitorHistory(monitor.id)
    const previousCheckTime = lastHistory?.executed_at ? new Date(lastHistory.executed_at) : null

    // 경과 일수 및 전체 기간 계산
    const daysElapsed = Math.ceil((currentTime.getTime() - releaseStart.getTime()) / (1000 * 60 * 60 * 24))
    const expiresAt = new Date(monitor.expires_at)
    const totalDurationDays = Math.ceil((expiresAt.getTime() - new Date(monitor.started_at).getTime()) / (1000 * 60 * 60 * 24))

    // 누적 데이터 수집
    const [cumulativeAggregation, crashFreeRates, detailedIssues, hourlyTrend] = await Promise.all([
      sentryService.getWindowAggregates(matchedRelease, releaseStart, currentTime),
      sentryService.getCrashFreeRate(matchedRelease, releaseStart, currentTime),
      sentryService.getDetailedTopIssues(matchedRelease, releaseStart, currentTime, previousCheckTime, 10),
      sentryService.getHourlyTrend(matchedRelease, currentTime, 24)
    ])

    // 최근 변화 계산 (선택적)
    let recentChange: VersionMonitorSnapshot['recentChange'] | undefined
    if (previousCheckTime && lastHistory) {
      const crashesSinceLastCheck = cumulativeAggregation.events - lastHistory.events_count

      if (crashesSinceLastCheck > 0) {
        const minutesSinceLastCheck = Math.round((currentTime.getTime() - previousCheckTime.getTime()) / (1000 * 60))
        recentChange = {
          lastCheckTime: previousCheckTime.toISOString(),
          crashesSinceLastCheck,
          changeDescription: `지난 체크 이후 ${minutesSinceLastCheck}분 동안 ${crashesSinceLastCheck}건의 크래시가 추가로 발생했습니다.`
        }
      }
    }

    const snapshot: VersionMonitorSnapshot = {
      monitorId: monitor.id,
      platform: monitor.platform,
      version: matchedRelease,
      monitorStartedAt: monitor.started_at,
      currentTime: currentTime.toISOString(),
      daysElapsed,
      totalDurationDays,

      cumulative: {
        totalCrashes: cumulativeAggregation.events,
        uniqueIssues: cumulativeAggregation.issues,
        affectedUsers: cumulativeAggregation.users,
        crashFreeRate: crashFreeRates.crashFreeRate,
        crashFreeSessionRate: crashFreeRates.crashFreeSessionRate
      },

      recentChange,

      topIssues: detailedIssues,

      hourlyTrend
    }

    return snapshot
  }

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
      
      // 5. 누적 데이터 수집 및 Slack 알림 전송
      let slackSent = false
      let snapshot: VersionMonitorSnapshot | null = null
      const platformSlackService = createSlackService(monitor.platform, monitor.is_test_mode || false)
      try {
        console.log(`📤 [${monitor.platform}:${monitor.base_release}] Slack 알림 전송 시도... (테스트 모드: ${monitor.is_test_mode})`)

        // 누적 데이터 수집
        snapshot = await this.collectCumulativeData(
          monitor,
          platformSentryService,
          releaseStart,
          windowEnd
        )

        // 심각도 판단 (slack.ts에서 import)
        const { calculateVersionMonitorSeverity } = await import('./slack')
        const severity = calculateVersionMonitorSeverity(snapshot)

        console.log(`📊 [${monitor.platform}:${monitor.base_release}] 심각도: ${severity}, CFR: ${snapshot.cumulative.crashFreeRate}%, 크래시: ${snapshot.cumulative.totalCrashes}건`)

        // 심각도에 따라 메시지 빌드
        let blocks
        if (severity === 'critical') {
          blocks = platformSlackService.buildCriticalVersionMonitorMessage(snapshot)
        } else if (severity === 'warning') {
          blocks = platformSlackService.buildWarningVersionMonitorMessage(snapshot)
        } else {
          blocks = platformSlackService.buildNormalVersionMonitorMessage(snapshot)
        }

        await platformSlackService.sendMessage(blocks)

        slackSent = true
        console.log(`✅ [${monitor.platform}:${monitor.base_release}] Slack 알림 전송 완료 (심각도: ${severity})`)
      } catch (slackError) {
        console.error(`❌ [${monitor.platform}:${monitor.base_release}] Slack 알림 전송 실패:`, slackError)
        console.error(`   - 에러 상세:`, slackError instanceof Error ? slackError.message : String(slackError))
        console.error(`   - 테스트 모드:`, monitor.is_test_mode)
        console.error(`   - 플랫폼:`, monitor.platform)
        // Slack 실패는 전체 실행 실패로 처리하지 않음
      }

      result.slackSent = slackSent

      // 6. 히스토리 저장 (누적 데이터 저장 - checkpoint)
      // snapshot이 있으면 누적 데이터를, 없으면 기존 window 데이터를 저장
      const historyAggregation: WindowAggregation = snapshot
        ? {
            events: snapshot.cumulative.totalCrashes,
            issues: snapshot.cumulative.uniqueIssues,
            users: snapshot.cumulative.affectedUsers
          }
        : totalAggregation

      await db.createMonitorHistory(
        monitor.id,
        windowStart,
        windowEnd,
        historyAggregation,
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
      console.log(`📤 [${monitor.platform}:${monitor.base_release}] 시작 알림 전송 시도... (테스트 모드: ${monitor.is_test_mode})`)
      const platformSlackService = createSlackService(monitor.platform, monitor.is_test_mode || false)
      await platformSlackService.sendStartNotification(
        monitor.platform,
        monitor.base_release,
        monitor.id,
        new Date(monitor.expires_at),
        monitor.custom_interval_minutes ?? undefined,
        monitor.is_test_mode ?? false
      )
      console.log(`✅ [${monitor.platform}:${monitor.base_release}] 시작 알림 전송 완료`)
    } catch (error) {
      console.error(`❌ [${monitor.platform}:${monitor.base_release}] 시작 알림 전송 실패:`, error)
      console.error(`   - 에러 상세:`, error instanceof Error ? error.message : String(error))
      console.error(`   - 테스트 모드:`, monitor.is_test_mode)
      console.error(`   - 플랫폼:`, monitor.platform)
    }
  }
  
  // 모니터링 종료 시 Slack 알림
  async notifyMonitorStop(
    monitor: MonitorSession,
    reason: 'manual' | 'expired'
  ): Promise<void> {
    try {
      console.log(`📤 [${monitor.platform}:${monitor.base_release}] 종료 알림 전송 시도... (테스트 모드: ${monitor.is_test_mode})`)

      const platformSlackService = createSlackService(monitor.platform, monitor.is_test_mode || false)
      const platformSentryService = createSentryService(monitor.platform)

      // matched_release 확인
      const matchedRelease = monitor.matched_release
      if (!matchedRelease) {
        console.warn(`⚠️ [${monitor.platform}:${monitor.base_release}] matched_release가 없어 종료 알림을 기본 형식으로 전송합니다`)
        await platformSlackService.sendStopNotification(
          monitor.platform,
          monitor.base_release,
          monitor.id,
          reason
        )
        return
      }

      // 릴리즈 시작 시간 가져오기
      const metadata = (monitor.metadata ?? {}) as Record<string, unknown>
      const releaseStartIso = typeof metadata.release_started_at === 'string' ? metadata.release_started_at : undefined
      let releaseStart = releaseStartIso ? new Date(releaseStartIso) : new Date(monitor.started_at)

      if (!releaseStart || Number.isNaN(releaseStart.getTime())) {
        releaseStart = new Date(monitor.started_at)
      }

      // 현재 시간까지 누적 데이터 수집
      const currentTime = new Date()

      console.log(`📊 [${monitor.platform}:${monitor.base_release}] 최종 누적 데이터 수집 중...`)
      const snapshot = await this.collectCumulativeData(
        monitor,
        platformSentryService,
        releaseStart,
        currentTime
      )

      console.log(`📊 [${monitor.platform}:${monitor.base_release}] 최종 통계: 크래시 ${snapshot.cumulative.totalCrashes}건, 이슈 ${snapshot.cumulative.uniqueIssues}개, CFR ${snapshot.cumulative.crashFreeRate.toFixed(2)}%`)

      // 새로운 완료 메시지 빌드
      const blocks = platformSlackService.buildVersionMonitorCompletionMessage(
        snapshot,
        monitor.started_at,
        monitor.expires_at,
        reason
      )

      await platformSlackService.sendMessage(blocks)

      console.log(`✅ [${monitor.platform}:${monitor.base_release}] 종료 알림 전송 완료`)
    } catch (error) {
      console.error(`❌ [${monitor.platform}:${monitor.base_release}] 종료 알림 전송 실패:`, error)
      console.error(`   - 에러 상세:`, error instanceof Error ? error.message : String(error))
      console.error(`   - 테스트 모드:`, monitor.is_test_mode)
      console.error(`   - 플랫폼:`, monitor.platform)
    }
  }
}

// 싱글톤 인스턴스
export const monitoringService = new MonitoringService()
