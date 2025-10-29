import { reportsDb } from './database'
import { aiAnalysisService } from './ai-analysis'
import { createSlackService } from '../slack'
import { createSentryService } from '../sentry'
import {
  getKSTDayBounds,
  getYesterday,
  formatKSTDate,
  mean,
  std,
  median,
  mad,
  calculateZScore,
  calculateMADScore
} from './utils'
import type {
  DailyReportData,
  TopIssue,
  NewIssue,
  SurgeIssue,
  AIAnalysis
} from './types'
import { getRequiredEnv, getPlatformEnv, getRequiredPlatformEnv, getPlatformEnvOrDefault, getSlackWebhookUrl } from '../utils'
import { buildDailyReportUrl } from '../url-utils'
import type { Platform } from '../types'

export interface DailyReportOptions {
  targetDate?: Date
  sendSlack?: boolean
  includeAI?: boolean
  triggerType?: 'scheduled' | 'manual'
  isTestMode?: boolean
}

// 급증 탐지 파라미터 (Python과 동일)
const SURGE_MIN_COUNT = 30
const SURGE_GROWTH_MULTIPLIER = 2.0
const SURGE_Z_THRESHOLD = 2.0
const SURGE_MAD_THRESHOLD = 3.5
const SURGE_MIN_NEW_BURST = 15
const BASELINE_DAYS = 7
const CANDIDATE_LIMIT = 100
const SURGE_MAX_RESULTS = 50
const SURGE_ABSOLUTE_MIN = SURGE_MIN_COUNT

// Slack 포맷 상수
const SLACK_MAX_NEW = 5
const SLACK_MAX_SURGE = 10
const TITLE_MAX = 90

interface SentryAggregateResult {
  'count()': number
  'count_unique(issue)': number
  'count_unique(user)': number
}

interface SentryIssueCountResult {
  issue: string
  title: string
  'count()': number
}

interface SentryTopIssueResult {
  issue: string
  title: string
  'count()': number
}

interface SentryNewIssueResult {
  id: string
  title: string
  count: string
  firstSeen: string
  permalink?: string
}

interface SentryCrashFreeResult {
  groups: Array<{
    series: {
      'crash_free_rate(session)'?: number[]
      'crash_free_rate(user)'?: number[]
    }
  }>
}

export class DailyReportService {
  private executionLogs: string[] = []
  private platform: Platform

  constructor(platform: Platform = 'android') {
    this.platform = platform
  }
  
  private log(message: string): void {
    const timestamp = new Date().toISOString()
    const logEntry = `[${timestamp}] ${message}`
    console.log(logEntry)
    this.executionLogs.push(logEntry)
  }
  
  async generateReport(options: DailyReportOptions = {}): Promise<{
    executionId: string
    data: DailyReportData
    aiAnalysis?: AIAnalysis
  }> {
    // 새로운 실행 시마다 로그 초기화
    this.executionLogs = []
    
    const startTime = Date.now()
    const {
      targetDate = getYesterday(),
      sendSlack = true,
      includeAI = true,
      triggerType = 'manual',
      isTestMode = false
    } = options

    this.log(`[Daily] [1/14] 환경 변수 로드 (${this.platform.toUpperCase()})...`)
    const token = getRequiredEnv('SENTRY_AUTH_TOKEN')
    const org = getRequiredEnv('SENTRY_ORG_SLUG')
    const projectSlug = getPlatformEnv(this.platform, 'PROJECT_SLUG')
    const projectIdEnv = getPlatformEnv(this.platform, 'PROJECT_ID')
    const environment = getPlatformEnvOrDefault(this.platform, 'SENTRY_ENVIRONMENT', 'production')
    // 리포트용 Slack Webhook URL 가져오기 (테스트/운영 모드 구분)
    let slackWebhook: string | null = null
    try {
      slackWebhook = isTestMode
        ? getSlackWebhookUrl(this.platform, true, false, false)
        : getSlackWebhookUrl(this.platform, false, false, true)
    } catch (error) {
      this.log(`Slack webhook URL을 가져올 수 없습니다(플랫폼별 필수): ${error}`)
      slackWebhook = null
    }
    
    this.log(`Slack webhook configured: ${!!slackWebhook}`)

    this.log(`[Daily] [2/14] 날짜 계산(KST 기준 어제/그저께)...`)
    // 어제와 그저께 날짜 계산
    const yesterday = targetDate
    const dayBeforeYesterday = new Date(yesterday)
    dayBeforeYesterday.setDate(yesterday.getDate() - 1)

    const yesterdayBounds = getKSTDayBounds(yesterday)
    const dayBeforeYesterdayBounds = getKSTDayBounds(dayBeforeYesterday)
    
    const yStart = yesterdayBounds.start.toISOString().replace('+00:00', 'Z')
    const yEnd = yesterdayBounds.end.toISOString().replace('+00:00', 'Z')
    const dbyStart = dayBeforeYesterdayBounds.start.toISOString().replace('+00:00', 'Z')
    const dbyEnd = dayBeforeYesterdayBounds.end.toISOString().replace('+00:00', 'Z')

    this.log(`  - 어제(KST): ${formatKSTDate(yesterday)} / UTC: ${yStart} ~ ${yEnd}`)
    this.log(`  - 그저께(KST): ${formatKSTDate(dayBeforeYesterday)} / UTC: ${dbyStart} ~ ${dbyEnd}`)

    this.log(`[Daily] [3/14] 프로젝트 확인/해결(org=${org}, slug=${projectSlug}, id_env=${projectIdEnv})...`)
    const projectId = await this.resolveProjectId(token, org, projectSlug, projectIdEnv)
    this.log(`  - project_id=${projectId}`)

    // 실행 기록 생성
    const execution = await reportsDb.createReportExecution(
      'daily',
      triggerType,
      yesterday,
      yesterdayBounds.start,
      yesterdayBounds.end,
      this.platform
    )

    try {
      // 어제 데이터 수집
      this.log(`[Daily] [4/14] 어제 집계 수집(count/unique issue/user)...`)
      const ySummary = await this.discoverAggregatesForDay(token, org, projectId, environment, yStart, yEnd)
      this.log(`  - events=${ySummary.crash_events} / issues=${ySummary.unique_issues} / users=${ySummary.impacted_users}`)

      this.log(`[Daily] [5/14] 어제 Crash Free(session/user) 수집...`)
      const [yCfS, yCfU] = await this.sessionsCrashFreeForDay(token, org, projectId, environment, yStart, yEnd)
      this.log(`  - crash_free(session)=${this.fmtPct(yCfS)} / crash_free(user)=${this.fmtPct(yCfU)}`)

      this.log(`[Daily] [6/14] 어제 상위 5개 이슈 수집...`)
      const yTop = await this.topIssuesForDay(token, org, projectId, environment, yStart, yEnd, 5)
      this.log(`  - top5 count=${yTop.length}`)

      this.log(`[Daily] [7/14] 어제 신규 발생 이슈(firstSeen 당일) 수집...`)
      const yNew = await this.newIssuesForDay(token, org, projectId, environment, yStart, yEnd)
      this.log(`  - new issues count=${yNew.length}`)

      this.log(`[Daily] [8/14] 어제 급증(서지) 이슈 탐지(베이스라인 ${BASELINE_DAYS}일)...`)
      const ySurgeAdv = await this.detectSurgeIssuesAdvanced(token, org, projectId, environment, yStart, yEnd)
      this.log(`  - surge detected=${ySurgeAdv.length} (min_count=${SURGE_MIN_COUNT})`)

      // 그저께 데이터 수집 (비교용)
      this.log(`[Daily] [9/14] 그저께 집계 수집...`)
      const dbySummary = await this.discoverAggregatesForDay(token, org, projectId, environment, dbyStart, dbyEnd)
      this.log(`  - events=${dbySummary.crash_events} / issues=${dbySummary.unique_issues} / users=${dbySummary.impacted_users}`)

      this.log(`[Daily] [10/14] 그저께 Crash Free(session/user) 수집...`)
      const [dbyCfS, dbyCfU] = await this.sessionsCrashFreeForDay(token, org, projectId, environment, dbyStart, dbyEnd)
      this.log(`  - crash_free(session)=${this.fmtPct(dbyCfS)} / crash_free(user)=${this.fmtPct(dbyCfU)}`)

      // 리포트 데이터 구성 (Python과 동일한 구조)
      const reportData: DailyReportData = {
        timezone: 'Asia/Seoul (KST)',
        [formatKSTDate(yesterday)]: {
          ...ySummary,
          issues_count: ySummary.unique_issues,
          unique_issues_in_events: ySummary.unique_issues,
          crash_free_sessions_pct: yCfS,
          crash_free_users_pct: yCfU,
          top_5_issues: yTop,
          new_issues: yNew,
          surge_issues: ySurgeAdv,
          window_utc: { start: yStart, end: yEnd }
        },
        [formatKSTDate(dayBeforeYesterday)]: {
          ...dbySummary,
          issues_count: dbySummary.unique_issues,
          unique_issues_in_events: dbySummary.unique_issues,
          crash_free_sessions_pct: dbyCfS,
          crash_free_users_pct: dbyCfU,
          window_utc: { start: dbyStart, end: dbyEnd }
        }
      }

      this.log(`[Daily] [11/14] 콘솔 출력(JSON)...`)
      this.log(`Report data: ${JSON.stringify(reportData, null, 2).substring(0, 500)}...`)

      // AI 분석
      let aiAnalysis: AIAnalysis | undefined
      if (includeAI && process.env.OPENAI_API_KEY) {
        this.log(`[Daily] [12/14] AI 코멘트 생성 시도(gpt-4o-mini)...`)
        try {
          aiAnalysis = await aiAnalysisService.generateDailyAdvice(
            reportData,
            formatKSTDate(yesterday),
            formatKSTDate(dayBeforeYesterday),
            environment
          )
          if ('fallback_text' in aiAnalysis) {
            this.log(`  - AI 생성 실패: ${(aiAnalysis as any).fallback_text}`)
          } else {
            this.log('  - AI 코멘트 생성 완료')
          }
        } catch (error) {
          this.log(`[Daily Report] AI analysis failed: ${error}`)
        }
      }

      // Slack 블록 구성 (미리보기/저장 용도 포함)
      this.log(`[Daily] [13/14] Slack Blocks 구축...`)
      const slackBlocks = this.buildSlackBlocksForDay(
        formatKSTDate(yesterday),
        environment,
        reportData[formatKSTDate(yesterday)] as any,
        reportData[formatKSTDate(dayBeforeYesterday)] as any,
        aiAnalysis ? this.buildAiAdviceBlocks(aiAnalysis) : undefined,
        aiAnalysis,
        org,
        projectId
      )
      this.log(`  - Slack blocks generated: ${slackBlocks.length} blocks`)
      this.log(`  - First block: ${JSON.stringify(slackBlocks[0] || {}).substring(0, 200)}...`)

      // Slack 전송
      let slackSent = false
      if (sendSlack && slackWebhook) {
        this.log(`[Daily] [14/14] Slack 전송 시도...`)
        this.log(`  - Webhook URL: ${slackWebhook.substring(0, 50)}...`)
        try {
          await this.postToSlack(slackWebhook, slackBlocks)
          this.log('  - 전송 완료 ✅')
          slackSent = true
        } catch (error) {
          this.log(`  - 전송 실패 ❌: ${error}`)
          this.log(`  - Error details: ${error instanceof Error ? error.stack : JSON.stringify(error)}`)
        }
      } else {
        this.log(`Slack Webhook 미설정 — 전송 스킵 (sendSlack=${sendSlack}, configured=${!!slackWebhook})`)
      }

      // 실행 완료 처리
      const executionTime = Date.now() - startTime
      this.log(`[Daily Report] Completed in ${executionTime}ms`)
      
      await reportsDb.completeReportExecution(
        execution.id,
        'success',
        { ...reportData, slack_blocks: slackBlocks },
        aiAnalysis,
        slackSent,
        undefined,
        executionTime,
        this.executionLogs
      )

      return {
        executionId: execution.id,
        data: reportData,
        aiAnalysis
      }
    } catch (error) {
      // 실행 실패 처리
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.log(`[Daily Report] Failed: ${errorMessage}`)
      if (error instanceof Error && error.stack) {
        this.log(`Stack trace: ${error.stack}`)
      }
      
      await reportsDb.completeReportExecution(
        execution.id,
        'error',
        undefined,
        undefined,
        false,
        errorMessage,
        Date.now() - startTime,
        this.executionLogs
      )
      
      throw error
    }
  }

  private async resolveProjectId(
    token: string,
    org: string,
    projectSlug?: string,
    projectIdEnv?: string
  ): Promise<number> {
    if (projectIdEnv) {
      return parseInt(projectIdEnv)
    }
    if (!projectSlug) {
      throw new Error(`${this.platform.toUpperCase()}_PROJECT_SLUG 또는 ${this.platform.toUpperCase()}_PROJECT_ID 중 하나는 필요합니다.`)
    }
    
    const response = await fetch(`https://sentry.io/api/0/organizations/${org}/projects/`, {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 30000
    })
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for GET projects`)
    }
    
    const projects = await response.json()
    for (const p of projects) {
      if (p.slug === projectSlug) {
        return parseInt(p.id)
      }
    }
    
    throw new Error(`'${projectSlug}' 프로젝트를 찾을 수 없습니다.`)
  }

  private async discoverAggregatesForDay(
    token: string,
    org: string,
    projectId: number,
    environment: string | null,
    startIsoUtc: string,
    endIsoUtc: string
  ): Promise<{ crash_events: number; unique_issues: number; impacted_users: number }> {
    const query = 'level:[error,fatal]' + (environment ? ` environment:${environment}` : '')
    const params = new URLSearchParams({
      field: 'count()',
      project: projectId.toString(),
      start: startIsoUtc,
      end: endIsoUtc,
      query,
      referrer: 'api.summaries.daily'
    })
    params.append('field', 'count_unique(issue)')
    params.append('field', 'count_unique(user)')

    const response = await fetch(`https://sentry.io/api/0/organizations/${org}/events/?${params}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 60000
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for GET events aggregates`)
    }

    const data = await response.json()
    const rows = data.data || []
    if (!rows.length) {
      return { crash_events: 0, unique_issues: 0, impacted_users: 0 }
    }

    const row0 = rows[0] as SentryAggregateResult
    return {
      crash_events: parseInt(String(row0['count()'] || 0)),
      unique_issues: parseInt(String(row0['count_unique(issue)'] || 0)),
      impacted_users: parseInt(String(row0['count_unique(user)'] || 0))
    }
  }

  private async sessionsCrashFreeForDay(
    token: string,
    org: string,
    projectId: number,
    environment: string | null,
    startIsoUtc: string,
    endIsoUtc: string
  ): Promise<[number | null, number | null]> {
    const params = new URLSearchParams({
      project: projectId.toString(),
      start: startIsoUtc,
      end: endIsoUtc,
      interval: '1d',
      field: 'crash_free_rate(session)',
      referrer: 'api.summaries.daily'
    })
    params.append('field', 'crash_free_rate(user)')
    if (environment) {
      params.set('environment', environment)
    }

    const response = await fetch(`https://sentry.io/api/0/organizations/${org}/sessions/?${params}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 60000
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for GET sessions`)
    }

    const data = await response.json() as SentryCrashFreeResult
    let cfS: number | null = null
    let cfU: number | null = null
    
    for (const g of data.groups || []) {
      const series = g.series || {}
      if (series['crash_free_rate(session)']?.length) {
        cfS = parseFloat(String(series['crash_free_rate(session)'].slice(-1)[0]))
      }
      if (series['crash_free_rate(user)']?.length) {
        cfU = parseFloat(String(series['crash_free_rate(user)'].slice(-1)[0]))
      }
    }
    
    return [cfS, cfU]
  }

  private async topIssuesForDay(
    token: string,
    org: string,
    projectId: number,
    environment: string | null,
    startIsoUtc: string,
    endIsoUtc: string,
    limit: number = 5
  ): Promise<TopIssue[]> {
    const query = 'level:[error,fatal]' + (environment ? ` environment:${environment}` : '')
    const params = new URLSearchParams({
      field: 'issue',
      project: projectId.toString(),
      start: startIsoUtc,
      end: endIsoUtc,
      query,
      orderby: '-count()',
      per_page: limit.toString(),
      referrer: 'api.summaries.top-issues'
    })
    params.append('field', 'title')
    params.append('field', 'count()')

    const response = await fetch(`https://sentry.io/api/0/organizations/${org}/events/?${params}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 60000
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for GET top issues`)
    }

    const data = await response.json()
    const rows = (data.data || []) as SentryTopIssueResult[]
    
    return rows.slice(0, limit).map(row => ({
      issue_id: row.issue,
      title: row.title,
      event_count: parseInt(String(row['count()'] || 0)),
      link: row.issue ? `https://sentry.io/organizations/${org}/issues/${row.issue}/` : null
    }))
  }

  private async newIssuesForDay(
    token: string,
    org: string,
    projectId: number,
    environment: string | null,
    startIsoUtc: string,
    endIsoUtc: string
  ): Promise<NewIssue[]> {
    const qParts = [`firstSeen:>=${startIsoUtc}`, `firstSeen:<${endIsoUtc}`, 'level:[error,fatal]']
    if (environment) {
      qParts.push(`environment:${environment}`)
    }
    const query = qParts.join(' ')
    
    const params = new URLSearchParams({
      project: projectId.toString(),
      since: startIsoUtc,
      until: endIsoUtc,
      query,
      sort: 'date',
      per_page: '100',
      referrer: 'api.summaries.new-issues'
    })

    const results: NewIssue[] = []
    let cursor: string | null = null

    while (true) {
      if (cursor) {
        params.set('cursor', cursor)
      }
      
      const response = await fetch(`https://sentry.io/api/0/organizations/${org}/issues/?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 60000
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for GET new issues`)
      }

      const items = (await response.json()) as SentryNewIssueResult[]
      for (const it of items) {
        const permalink = it.permalink || (it.id ? `https://sentry.io/organizations/${org}/issues/${it.id}/` : null)
        results.push({
          issue_id: it.id,
          title: it.title,
          event_count: it.count ? parseInt(it.count) : null,
          first_seen: it.firstSeen,
          link: permalink
        })
      }

      // 페이지네이션 처리
      const linkHeader = response.headers.get('link') || ''
      cursor = this.parseLinkCursor(linkHeader)
      if (!cursor) break
    }

    return results
  }

  private parseLinkCursor(linkHeader: string): string | null {
    if (linkHeader.includes('rel="next"') && linkHeader.includes('results="true"')) {
      try {
        const start = linkHeader.indexOf('cursor=') + 7
        const end = linkHeader.indexOf('>', start)
        return linkHeader.substring(start, end)
      } catch {
        return null
      }
    }
    return null
  }

  private async detectSurgeIssuesAdvanced(
    token: string,
    org: string,
    projectId: number,
    environment: string | null,
    targetStartUtc: string,
    targetEndUtc: string,
    baselineDays: number = BASELINE_DAYS,
    perPage: number = 100,
    maxPages: number = 10
  ): Promise<SurgeIssue[]> {
    // 타겟일 이슈별 카운트 (페이지네이션)
    const todayMap = await this.issueCountsMapForDay(token, org, projectId, environment, targetStartUtc, targetEndUtc, perPage, maxPages)

    // 직전 N일 맵들
    const tStartDt = new Date(targetStartUtc.replace('Z', '+00:00'))
    const prevMaps: Array<{ [issueId: string]: { count: number; title?: string } }> = []
    
    for (let i = 1; i <= baselineDays; i++) {
      const dayStartDt = new Date(tStartDt.getTime() - i * 24 * 60 * 60 * 1000)
      const dayEndDt = new Date(dayStartDt.getTime() + 24 * 60 * 60 * 1000)
      const startIso = dayStartDt.toISOString().replace('+00:00', 'Z')
      const endIso = dayEndDt.toISOString().replace('+00:00', 'Z')
      
      const prevMap = await this.issueCountsMapForDay(token, org, projectId, environment, startIso, endIso, perPage, maxPages)
      prevMaps.push(prevMap)
    }

    const results: SurgeIssue[] = []
    const eps = 1e-9

    for (const [iid, curInfo] of Object.entries(todayMap)) {
      const cur = parseInt(String(curInfo.count || 0))

      // 1차 필터: 절대 최소 건수
      if (cur < SURGE_ABSOLUTE_MIN) {
        continue
      }

      const title = curInfo.title || '(제목 없음)'
      const link = `https://sentry.io/organizations/${org}/issues/${iid}/`

      // D-1 및 베이스라인
      const dby = parseInt(String(prevMaps[0]?.[iid]?.count || 0))
      const baselineCounts = prevMaps.map(pm => parseInt(String(pm[iid]?.count || 0)))

      const meanVal = mean(baselineCounts)
      const stdVal = std(baselineCounts)
      const medianVal = median(baselineCounts)
      const madVal = mad(baselineCounts, medianVal)

      const z = stdVal > 0 ? (cur - meanVal) / (stdVal + eps) : (cur > meanVal ? Number.POSITIVE_INFINITY : 0)
      const madScore = madVal > 0 ? (cur - medianVal) / (1.4826 * madVal + eps) : (cur > medianVal ? Number.POSITIVE_INFINITY : 0)
      const growth = cur / Math.max(dby, 1)

      const isAllZero = baselineCounts.every(v => v === 0)
      const conditions = {
        growth: growth >= SURGE_GROWTH_MULTIPLIER,
        zscore: !isFinite(z) ? false : z >= SURGE_Z_THRESHOLD,
        madscore: !isFinite(madScore) ? false : madScore >= SURGE_MAD_THRESHOLD,
        new_burst: isAllZero && cur >= Math.max(SURGE_MIN_NEW_BURST, SURGE_ABSOLUTE_MIN)
      }

      if (Object.values(conditions).some(Boolean)) {
        results.push({
          issue_id: iid,
          title,
          event_count: cur,
          link,
          dby_count: dby,
          growth_multiplier: Math.round(growth * 100) / 100,
          zscore: !isFinite(z) ? undefined : Math.round(z * 100) / 100,
          mad_score: !isFinite(madScore) ? undefined : Math.round(madScore * 100) / 100,
          baseline_mean: Math.round(meanVal * 100) / 100,
          baseline_std: Math.round(stdVal * 100) / 100,
          baseline_median: Math.round(medianVal * 100) / 100,
          baseline_mad: Math.round(madVal * 100) / 100,
          baseline_counts: baselineCounts,
          reasons: Object.entries(conditions).filter(([_, v]) => v).map(([k, _]) => k)
        })
      }
    }

    // 2차 보정: 혹시라도 계산/타입 이슈로 통과한 항목을 다시 절대 최소건수로 걸러냄
    const filteredResults = results.filter(r => parseInt(String(r.event_count || 0)) >= SURGE_ABSOLUTE_MIN)

    // 정렬/상한
    filteredResults.sort((a, b) => {
      return b.event_count - a.event_count ||
             (b.zscore || 0) - (a.zscore || 0) ||
             (b.mad_score || 0) - (a.mad_score || 0) ||
             b.growth_multiplier - a.growth_multiplier
    })

    return filteredResults.slice(0, SURGE_MAX_RESULTS)
  }

  private async issueCountsMapForDay(
    token: string,
    org: string,
    projectId: number,
    environment: string | null,
    startIsoUtc: string,
    endIsoUtc: string,
    perPage: number = 100,
    maxPages: number = 10
  ): Promise<{ [issueId: string]: { count: number; title?: string } }> {
    const query = 'level:[error,fatal]' + (environment ? ` environment:${environment}` : '')
    const out: { [issueId: string]: { count: number; title?: string } } = {}
    
    let cursor: string | null = null
    let page = 0
    
    while (true) {
      page++
      const params = new URLSearchParams({
        field: 'issue',
        project: projectId.toString(),
        start: startIsoUtc,
        end: endIsoUtc,
        query,
        orderby: '-count()',
        per_page: perPage.toString(),
        referrer: 'api.summaries.issue-counts'
      })
      params.append('field', 'title')
      params.append('field', 'count()')
      
      if (cursor) {
        params.set('cursor', cursor)
      }

      const response = await fetch(`https://sentry.io/api/0/organizations/${org}/events/?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 60000
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for GET issue counts`)
      }

      const data = await response.json()
      const rows = (data.data || []) as SentryIssueCountResult[]
      
      for (const row of rows) {
        const iid = row.issue
        if (!iid) continue
        
        out[String(iid)] = {
          count: parseInt(String(row['count()'] || 0)),
          title: row.title
        }
      }

      const linkHeader = response.headers.get('link') || ''
      cursor = this.parseLinkCursor(linkHeader)
      if (!cursor || page >= maxPages) break
    }
    
    return out
  }

  private fmtPct(v: number | null): string {
    if (v === null) return 'N/A'
    const pct = v * 100
    const truncated = Math.floor(pct * 100) / 100
    return `${truncated.toFixed(2)}%`
  }

  private truncate(s: string | null | undefined, n: number): string {
    if (!s) return '(제목 없음)'
    return s.length <= n ? s : s.substring(0, n - 1) + '…'
  }

  // 델타 포맷팅 헬퍼 (참고 코드 기반)
  private formatDelta(delta: number): string {
    if (delta > 0) {
      return `+${delta.toFixed(1)}% 🔺`
    } else if (delta < 0) {
      return `${delta.toFixed(1)}% 🔻`
    } else {
      return '변화 없음 —'
    }
  }

  // 퍼센트 포인트 델타 포맷팅
  private formatPercentagePointDelta(delta: number): string {
    if (Math.abs(delta) < 0.0001) {
      return '변화 없음 —'
    }
    const emoji = delta >= 0 ? '↑' : '↓'
    return `${emoji} ${Math.abs(delta * 100).toFixed(1)}%p`
  }

  private diffStr(cur: number, prev: number, suffix: string = '건'): string {
    const delta = cur - prev
    let arrow: string
    if (delta > 0) {
      arrow = '🔺'
    } else if (delta < 0) {
      arrow = '🔻'
    } else {
      arrow = '—'
    }
    let ratio = ''
    if (prev > 0) {
      ratio = ` (${((delta / prev) * 100).toFixed(1).replace(/^\+/, '+')}%)`
    }
    return `${cur}${suffix} ${arrow}${Math.abs(delta)}${suffix}${ratio}`
  }

  private issueLineKr(item: TopIssue | NewIssue): string {
    const title = this.truncate(item.title, TITLE_MAX)
    const link = item.link
    const count = item.event_count
    const countTxt = typeof count === 'number' ? `${count}건` : '–'
    const titleLink = link ? `<${link}|${title}>` : title
    return `• ${titleLink} · ${countTxt}`
  }

  private surgeExplanationKr(item: SurgeIssue): string {
    const base = this.issueLineKr(item as any)
    const cur = item.event_count || 0
    const d1 = item.dby_count || 0
    const meanV = item.baseline_mean
    const medV = item.baseline_median
    const reasons = item.reasons || []
    
    // 서술: 전일 대비, 7일 평균/중앙값 대비
    const parts = []
    parts.push(`전일 ${d1}건 → 어제 ${cur}건으로 급증.`)
    if (typeof meanV === 'number' && typeof medV === 'number') {
      parts.push(`최근 7일 평균 ${meanV.toFixed(1)}건/중앙값 ${medV.toFixed(0)}건 대비 크게 증가.`)
    }
    
    // 규칙명만 간단 표기
    if (reasons.length > 0) {
      const ko: { [key: string]: string } = {
        growth: '전일 대비 급증',
        zscore: '평균 대비 통계적 급증',
        madscore: '중앙값 대비 이상치',
        new_burst: '최근 기록 거의 없음에서 폭증'
      }
      const pretty = reasons.map(r => ko[r] || r)
      parts.push('판정 근거: ' + pretty.join('/'))
    }
    
    const detail = '  ↳ ' + parts.join(' ')
    return `${base}\n${detail}`
  }

  private parseIsoToKstLabel(startUtcIso: string, endUtcIso: string): string {
    const toKst = (iso: string) => {
      const utc = new Date(iso.replace('Z', '+00:00'))
      return new Date(utc.getTime() + 9 * 60 * 60 * 1000) // UTC + 9시간 = KST
    }
    const s = toKst(startUtcIso)
    const e = toKst(endUtcIso)
    
    const sTxt = s.toISOString().substring(0, 16).replace('T', ' ')
    const eTxt = e.toISOString().substring(0, 16).replace('T', ' ')
    return `${sTxt} ~ ${eTxt} (KST)`
  }

  private buildAiAdviceBlocks(ai: AIAnalysis): any[] {
    const blocks: any[] = []
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*:brain: AI 분석 코멘트*'
      }
    })

    if ('fallback_text' in ai) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: (ai as any).fallback_text
        }
      })
      blocks.push({ type: 'divider' })
      return blocks
    }

    const summaryText = (ai.newsletter_summary || '').trim()
    if (summaryText) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `> ${summaryText}`
        }
      })
    }

    const actions = ai.today_actions || []
    if (actions.length > 0) {
      const lines = actions.map(x => {
        const t = (x.title || '').trim() || '(제목 없음)'
        const s = (x.suggestion || '').trim()
        const extra = []
        if (x.owner_role) extra.push(`담당: ${x.owner_role}`)
        if (x.why) extra.push(`이유: ${x.why}`)
        const suffix = extra.length > 0 ? ` _(${extra.join(', ')})_` : ''
        return `• *${t}* — ${s}${suffix}`
      })
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*오늘의 액션*\n${lines.join('\n')}`
        }
      })
    }

    blocks.push({ type: 'divider' })
    return blocks
  }

  private buildFooterActionsBlock(
    org: string,
    projectId: number,
    envLabel: string | null,
    win: { start?: string; end?: string }
  ): any {
    const startIso = win.start || ''
    const endIso = win.end || ''
    const urls = this.buildSentryActionUrls(org, projectId, envLabel, startIso, endIso)

    return {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '📊 대시보드' },
          url: urls.dashboard_url
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🔍 해당 기간 이슈 보기' },
          url: urls.issues_filtered_url
        }
      ]
    }
  }

  private buildSentryActionUrls(
    org: string,
    projectId: number,
    environment: string | null,
    startIsoUtc: string,
    endIsoUtc: string
  ): { dashboard_url: string; issues_filtered_url: string } {
    // 1) 대시보드 URL
    const envDash = getPlatformEnv(this.platform, 'DASHBOARD_URL')
    const dashId = getPlatformEnv(this.platform, 'DASH_BOARD_ID')
    let dashboardUrl: string

    if (envDash) {
      dashboardUrl = envDash
    } else if (dashId) {
      dashboardUrl = `https://sentry.io/organizations/${org}/dashboard/${dashId}/?project=${projectId}`
    } else {
      dashboardUrl = `https://sentry.io/organizations/${org}/projects/`
    }

    // 2) 이슈 목록 URL
    const base = `https://sentry.io/organizations/${org}/issues/`
    const qParts = ['level:[error,fatal]']
    if (environment) {
      qParts.push(`environment:${environment}`)
    }
    const q = encodeURIComponent(qParts.join(' '))
    const s = encodeURIComponent(startIsoUtc)
    const e = encodeURIComponent(endIsoUtc)
    const issuesFilteredUrl = `${base}?project=${projectId}&query=${q}&start=${s}&end=${e}`

    return {
      dashboard_url: dashboardUrl,
      issues_filtered_url: issuesFilteredUrl
    }
  }

  private buildDailyReportPageUrl(dateLabel: string): string {
    // 동적 URL 생성 유틸리티 사용
    return buildDailyReportUrl(this.platform, dateLabel)
  }

  private normTitle(s: string): string {
    return (s || '').toLowerCase().trim().replace(/…/g, '').replace(/\s+/g, ' ')
  }

  private renderTop5WithAi(top5: TopIssue[], ai: AIAnalysis): string {
    const notes = ai.per_issue_notes || []
    // 인덱스: issue_id → [notes], title_norm → [notes]
    const byId: { [key: string]: any[] } = {}
    const byTn: { [key: string]: any[] } = {}
    
    for (const n of notes) {
      if (typeof n !== 'object') continue
      const iid = String(n.issue_id || '').trim()
      const ititle = n.issue_title || ''
      const tn = this.normTitle(ititle)
      
      if (iid) {
        byId[iid] = byId[iid] || []
        byId[iid].push(n)
      }
      if (tn) {
        byTn[tn] = byTn[tn] || []
        byTn[tn].push(n)
      }
    }

    const lines: string[] = []
    for (const it of top5) {
      const title = this.truncate(it.title, TITLE_MAX)
      const link = it.link
      const cnt = it.event_count
      const cntT = typeof cnt === 'number' ? `${cnt}건` : '–'
      const head = link ? `• <${link}|${title}> · ${cntT}` : `• ${title} · ${cntT}`
      lines.push(head)

      // 매칭 노트 수집
      const matched: any[] = []
      const iid = String(it.issue_id || '').trim()
      if (iid && byId[iid]) {
        matched.push(...byId[iid])
      } else {
        const tn = this.normTitle(title)
        // exact 우선, 없으면 startswith 유사 매칭
        if (byTn[tn]) {
          matched.push(...byTn[tn])
        } else {
          // 느슨한 startswith
          for (const [k, v] of Object.entries(byTn)) {
            if (tn.startsWith(k) || k.startsWith(tn)) {
              matched.push(...v)
              break
            }
          }
        }
      }

      // 들여쓴 불릿 (있을 때만)
      for (const n of matched) {
        const note = (n.note || '').trim()
        const cause = (n.why || n.root_cause || '').trim()
        if (cause) {
          lines.push(`  ◦ 원인/점검: ${cause}`)
        }
        if (note) {
          lines.push(`  ◦ 코멘트: ${note}`)
        }
      }
    }

    return lines.join('\n')
  }

  private buildSlackBlocksForDay(
    dateLabel: string,
    envLabel: string | null,
    dayObj: any,
    prevDayObj: any = null,
    aiBlocks: any[] | undefined = undefined,
    aiData: AIAnalysis | undefined = undefined,
    org: string | null = null,
    projectId: number | null = null
  ): any[] {
    // 현재값
    const cfS = dayObj.crash_free_sessions_pct
    const cfU = dayObj.crash_free_users_pct
    const events = parseInt(String(dayObj.crash_events || 0))
    const issues = parseInt(String(dayObj.unique_issues || 0))
    const users = parseInt(String(dayObj.impacted_users || 0))
    const surgeIssues = (dayObj.surge_issues || []) as SurgeIssue[]
    const newIssues = (dayObj.new_issues || []) as NewIssue[]

    // 전일값
    let prevEvents = 0
    let prevUsers = 0
    let prevCfU = null as number | null
    if (prevDayObj) {
      prevEvents = parseInt(String(prevDayObj.crash_events || 0))
      prevUsers = parseInt(String(prevDayObj.impacted_users || 0))
      prevCfU = prevDayObj.crash_free_users_pct
    }

    // 증감률 계산
    const eventChangePercent = prevEvents > 0 ? ((events - prevEvents) / prevEvents) * 100 : 0
    const userChangePercent = prevUsers > 0 ? ((users - prevUsers) / prevUsers) * 100 : 0
    const cfuChange = prevCfU !== null && cfU !== null ? cfU - prevCfU : 0

    // Critical 이슈 탐지 (신규 + fatal 레벨 or 영향 사용자 많음)
    const criticalIssues = surgeIssues.filter(issue => {
      const isNewFatal = newIssues.some(n => n.issue_id === issue.issue_id)
      const highImpact = issue.event_count >= 100
      return isNewFatal || highImpact
    })

    // 상태 판정
    let status: 'normal' | 'warning' | 'critical' = 'normal'
    let statusEmoji = '✅'
    let statusText = '정상'
    const reasons: string[] = []

    // Critical 판정
    if (criticalIssues.length > 0) {
      status = 'critical'
      reasons.push(`Critical 이슈 ${criticalIssues.length}건`)
    }
    if (cfU !== null && cfU < 0.99) {
      status = 'critical'
      reasons.push(`Crash Free Rate ${this.fmtPct(cfU)} (99% 미만)`)
    }
    if (eventChangePercent >= 200) {
      status = 'critical'
      reasons.push(`이벤트 ${eventChangePercent.toFixed(0)}% 급증`)
    }
    if (cfuChange < -0.01) { // -1.0%p 이하 하락
      status = 'critical'
      reasons.push(`Crash Free Rate ${Math.abs(cfuChange * 100).toFixed(1)}%p 하락`)
    }

    // Warning 판정 (Critical이 아닐 때만)
    if (status === 'normal') {
      if (surgeIssues.length > 0) {
        status = 'warning'
        reasons.push(`급증 이슈 ${surgeIssues.length}건`)
      }
      if (cfU !== null && cfU >= 0.99 && cfU < 0.995) {
        status = 'warning'
        reasons.push(`Crash Free Rate ${this.fmtPct(cfU)} (99.5% 미만)`)
      }
      if (eventChangePercent >= 100) {
        status = 'warning'
        reasons.push(`이벤트 ${eventChangePercent.toFixed(0)}% 증가`)
      }
      if (cfuChange < -0.005 && cfuChange >= -0.01) { // -0.5%p ~ -1.0%p 하락
        status = 'warning'
        reasons.push(`Crash Free Rate ${Math.abs(cfuChange * 100).toFixed(1)}%p 하락`)
      }
    }

    // 상태별 이모지/텍스트 설정
    if (status === 'critical') {
      statusEmoji = '🚨'
      statusText = '긴급'
    } else if (status === 'warning') {
      statusEmoji = '⚠️'
      statusText = '주의'
    } else {
      reasons.push('정상 범위')
    }

    // 집계 구간
    const win = dayObj.window_utc || {}
    const kstStart = win.start ? this.parseIsoToKstDate(win.start) : dateLabel
    const kstEnd = win.end ? this.parseIsoToKstDate(win.end) : dateLabel

    // 플랫폼 텍스트
    const platformText = this.platform === 'android' ? 'Android' : 'iOS'

    // 디버깅용 로그
    this.log(`  - Severity: ${status} (${reasons.join(', ')})`)

    const blocks: any[] = []

    // ========== 헤더 ==========
    blocks.push({
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${statusEmoji} ${platformText} 일간 리포트 — ${dateLabel} (${statusText})`,
        emoji: true
      }
    })

    // 상세 리포트 URL
    const detailPageUrl = this.buildDailyReportPageUrl(dateLabel)

    // ========== 패턴별 본문 ==========
    if (status === 'normal') {
      // ✅ 정상 패턴
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            '*📊 이슈 수치가 정상입니다*',
            `• Crash Free Rate: ${this.fmtPct(cfU)} (${this.formatPercentagePointDelta(cfuChange)})`,
            `• 크래시 이벤트: ${events}건 (전일 대비 ${this.formatDelta(eventChangePercent)})`,
            `• 영향 사용자: ${users}명 (전일 대비 ${this.formatDelta(userChangePercent)})`
          ].join('\n')
        }
      })
    } else if (status === 'warning') {
      // ⚠️ 주의 패턴
      const reasonText = reasons.length > 0 ? `\n\n*⚠️ 원인:* ${reasons.join(', ')}` : ''

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            '*📊 오늘은 주의가 필요합니다*',
            `• Crash Free Rate: ${this.fmtPct(cfU)} (${this.formatPercentagePointDelta(cfuChange)})`,
            `• 크래시 이벤트: ${events}건 (전일 대비 ${this.formatDelta(eventChangePercent)})`,
            `• 영향 사용자: ${users}명 (전일 대비 ${this.formatDelta(userChangePercent)})${reasonText}`
          ].join('\n')
        }
      })

      // 급증 이슈 (최대 3개, 참고 코드 기반)
      if (surgeIssues.length > 0) {
        blocks.push({ type: 'divider' })
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*🔥 급증 이슈 (${surgeIssues.length}건)*`
          }
        })

        const topSurges = surgeIssues.slice(0, 3)
        const webUrl = process.env.NEXT_PUBLIC_WEB_URL || process.env.WEB_URL || ''

        topSurges.forEach((issue, idx) => {
          const isNew = newIssues.some(n => n.issue_id === issue.issue_id)
          const growthRate = issue.growth_multiplier ? Math.round((issue.growth_multiplier - 1) * 100) : 0
          const statusBadge = isNew ? '🆕 신규 이슈' : `🔥 급증 (${growthRate}%)`
          const prevCount = issue.dby_count || 0
          const title = this.truncate(issue.title, 80)
          const link = issue.link || ''

          const block: any = {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: [
                `${idx + 1}. ${link ? `<${link}|*${title}*>` : `*${title}*`}`,
                `   • 상태: ${statusBadge}`,
                `   • 발생: ${issue.event_count}건 (어제 ${prevCount}건)`,
                `   • 영향: ${issue.event_count}명`
              ].join('\n')
            }
          }

          // AI 분석 버튼 추가 (WEB_URL이 설정되어 있을 때만)
          if (webUrl && issue.issue_id) {
            block.accessory = {
              type: 'button',
              text: { type: 'plain_text', text: '💡 AI 분석' },
              url: `${webUrl}/sentry-analysis?id=${issue.issue_id}`
            }
          }

          blocks.push(block)
        })
      }
    } else {
      // 🚨 긴급 패턴
      const reasonText = reasons.length > 0 ? `\n\n*🚨 원인:* ${reasons.join(', ')}` : ''

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*⚠️ 심각한 상황 - 즉시 확인 필요!*`
        }
      })

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `• Crash Free Rate: ${this.fmtPct(cfU)} (${this.formatPercentagePointDelta(cfuChange)})`,
            `• 크래시 이벤트: ${events}건 (전일 대비 ${this.formatDelta(eventChangePercent)})`,
            `• 영향 사용자: ${users}명 (전일 대비 ${this.formatDelta(userChangePercent)})${reasonText}`
          ].join('\n')
        }
      })

      // Critical 이슈 섹션
      if (criticalIssues.length > 0) {
        blocks.push({ type: 'divider' })
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*🚨 Critical 이슈 (${criticalIssues.length}건)*`
          }
        })

        const webUrl = process.env.NEXT_PUBLIC_WEB_URL || process.env.WEB_URL || ''

        criticalIssues.slice(0, 2).forEach(criticalIssue => {
          const isNew = newIssues.some(n => n.issue_id === criticalIssue.issue_id)
          const statusLabel = isNew ? '🆕 신규 Fatal 에러' : '🔥 Critical 급증'
          const title = this.truncate(criticalIssue.title, 80)
          const link = criticalIssue.link || ''
          const userImpactPercent = users > 0 ? Math.round((criticalIssue.event_count / users) * 100) : 0

          const block: any = {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: [
                link ? `<${link}|*${title}*>` : `*${title}*`,
                `• 상태: ${statusLabel}`,
                `• 발생: ${criticalIssue.event_count}건`,
                `• 영향: ${criticalIssue.event_count}명 (전체 사용자의 ${userImpactPercent}%)`,
                `• 설명: 이 이슈가 앱을 사용 불가능하게 만들고 있습니다`
              ].join('\n')
            }
          }

          // AI 분석 버튼 추가
          if (webUrl && criticalIssue.issue_id) {
            block.accessory = {
              type: 'button',
              text: { type: 'plain_text', text: '💡 AI 분석' },
              url: `${webUrl}/sentry-analysis?id=${criticalIssue.issue_id}`
            }
          }

          blocks.push(block)
        })
      }

      // 기타 급증 이슈
      const otherSurges = surgeIssues.filter(s => !criticalIssues.includes(s)).slice(0, 2)
      if (otherSurges.length > 0) {
        blocks.push({ type: 'divider' })
        const otherLines = otherSurges.map((issue, idx) => {
          const title = this.truncate(issue.title, 60)
          const link = issue.link || ''
          const isNew = newIssues.some(n => n.issue_id === issue.issue_id)
          const growthRate = issue.growth_multiplier ? Math.round((issue.growth_multiplier - 1) * 100) : 0
          const statusLabel = isNew ? '신규' : `+${growthRate}%`
          const titleText = link ? `<${link}|${title}>` : title
          return `${idx + 1}. ${titleText} (${issue.event_count}건, ${statusLabel})`
        })

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*🔥 기타 급증 이슈 (${otherSurges.length}건)*\n${otherLines.join('\n')}`
          }
        })
      }
    }

    // ========== 상세 리포트 버튼 ==========
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '📊 상세 리포트 보기'
          },
          url: detailPageUrl
        }
      ]
    })

    // ========== 집계 구간 ==========
    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `집계 구간: ${kstStart} 00:00 ~ 23:59 (KST)`
      }]
    })

    return blocks
  }

  // ISO UTC 날짜를 KST 날짜 문자열로 변환 (YYYY-MM-DD 형식)
  private parseIsoToKstDate(isoUtc: string): string {
    const utc = new Date(isoUtc.replace('Z', '+00:00'))
    const kst = new Date(utc.getTime() + 9 * 60 * 60 * 1000)
    return kst.toISOString().split('T')[0]
  }

  private async postToSlack(webhookUrl: string, blocks: any[]): Promise<void> {
    const payload = { blocks }
    this.log(`  - Payload size: ${JSON.stringify(payload).length} characters`)
    this.log(`  - Blocks count: ${blocks.length}`)

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeout: 30000
      })

      this.log(`  - Response status: ${response.status} ${response.statusText}`)
      this.log(`  - Response headers: ${JSON.stringify(Object.fromEntries(response.headers.entries()))}`)

      if (!response.ok) {
        const text = await response.text()
        this.log(`  - Response body: ${text.substring(0, 500)}`)
        throw new Error(`Slack post failed: ${response.status} - ${text.substring(0, 200)}`)
      } else {
        const text = await response.text()
        this.log(`  - Response body: ${text || '(empty)'}`)
      }
    } catch (error) {
      this.log(`  - Fetch error: ${error}`)
      if (error instanceof Error) {
        this.log(`  - Error name: ${error.name}`)
        this.log(`  - Error message: ${error.message}`)
        if (error.stack) {
          this.log(`  - Error stack: ${error.stack.substring(0, 500)}`)
        }
      }
      throw error
    }
  }

  /**
   * 최근 7일간의 크래시 데이터를 조회
   * @param platform 플랫폼 (android | ios)
   * @param targetDate 기준 날짜 (YYYY-MM-DD 형식)
   * @returns 최근 7일간의 일별 크래시 데이터
   */
  async getLast7DaysData(
    targetDate: string
  ): Promise<Array<{
    date: string
    events: number
    issues: number
    users: number
    crashFreeRate: number
  }>> {
    const result: Array<{
      date: string
      events: number
      issues: number
      users: number
      crashFreeRate: number
    }> = []

    // targetDate로부터 7일 전까지 순회
    const target = new Date(targetDate)

    for (let i = 6; i >= 0; i--) {
      const currentDate = new Date(target)
      currentDate.setDate(target.getDate() - i)
      const dateStr = formatKSTDate(currentDate)

      try {
        // 해당 날짜의 리포트 조회
        const reports = await reportsDb.getReportHistory(
          'daily',
          this.platform,
          1,
          0,
          dateStr,
          dateStr
        )

        if (reports.length > 0 && reports[0].status === 'success') {
          const report = reports[0]
          const resultData = report.result_data as any

          // 날짜 키로 데이터 추출
          const dayData = resultData?.[dateStr]

          if (dayData && typeof dayData === 'object') {
            result.push({
              date: dateStr,
              events: dayData.crash_events || 0,
              issues: dayData.unique_issues || 0,
              users: dayData.impacted_users || 0,
              crashFreeRate: dayData.crash_free_users_pct !== null && dayData.crash_free_users_pct !== undefined
                ? dayData.crash_free_users_pct * 100  // 0.9988 -> 99.88
                : 0
            })
          } else {
            // 데이터가 없으면 0으로 채움
            result.push({
              date: dateStr,
              events: 0,
              issues: 0,
              users: 0,
              crashFreeRate: 0
            })
          }
        } else {
          // 리포트가 없으면 0으로 채움
          result.push({
            date: dateStr,
            events: 0,
            issues: 0,
            users: 0,
            crashFreeRate: 0
          })
        }
      } catch (error) {
        console.error(`Failed to fetch data for ${dateStr}:`, error)
        // 오류 발생 시 0으로 채움
        result.push({
          date: dateStr,
          events: 0,
          issues: 0,
          users: 0,
          crashFreeRate: 0
        })
      }
    }

    return result
  }
}

export const dailyReportService = new DailyReportService()
