import { reportsDb } from './database'
import { getPlatformEnv, getPlatformEnvOrDefault, getSlackWebhookUrl } from '../utils'
import type { Platform } from '../types'
import type { WeeklyReportData, WeeklyIssue, NewIssue, WeeklySurgeIssue, ReleaseFix, AIAnalysis } from './types'

// Python 스크립트와 동일한 상수들
const API_BASE = "https://sentry.io/api/0"
const TITLE_MAX = 90
const WEEKLY_TOP_LIMIT = 5
const WEEKLY_NEW_LIMIT = 10
const WEEKLY_SURGE_LIMIT = 10
const WEEKLY_RESOLVED_MIN_EVENTS = 20
const WEEKLY_RESOLVED_MIN_USERS = 10
const WEEKLY_STALE_MIN_AGE_DAYS = 30
const WEEKLY_STALE_MIN_EVENTS = 5
const WEEKLY_STALE_MIN_USERS = 3
const WEEKLY_STALE_LIMIT = 20
const WEEKLY_SURGE_MIN_EVENTS = 50
const WEEKLY_SURGE_GROWTH_MULTIPLIER = 2.0
const WEEKLY_SURGE_Z_THRESHOLD = 2.0
const WEEKLY_SURGE_MAD_THRESHOLD = 3.5
const WEEKLY_BASELINE_WEEKS = 4
const RELEASE_FIX_IMPROVEMENT_DROP_PCT = 80.0
const RELEASE_FIXES_MIN_BASE_EVENTS = 10
const WEEKLY_RELEASE_FIXES_PER_RELEASE_LIMIT = 20
const LEVEL_QUERY = "level:[error,fatal]"
const SEMVER_RE = /^\d+\.\d+\.\d+(?:\+\d+)?$/

export interface WeeklyReportOptions {
  targetWeek?: Date // 월요일 날짜
  startDate?: Date
  endDate?: Date
  sendSlack?: boolean
  includeAI?: boolean
  triggerType?: 'scheduled' | 'manual'
  isTestMode?: boolean
}

export class WeeklyReportService {
  private executionLogs: string[] = []
  private platform: Platform

  constructor(platform: Platform = 'android') {
    this.platform = platform
  }
  
  private log(message: string): void {
    console.log(`[Weekly] ${message}`)
    this.executionLogs.push(`[Weekly] ${message}`)
  }
  
  // Python 스크립트의 유틸리티 메서드들
  private kstWeekBoundsForLastWeek(todayKst: Date): { start: Date; end: Date } {
    const dow = (todayKst.getDay() + 6) % 7 // Mon=0
    const thisMon = new Date(todayKst)
    thisMon.setHours(0, 0, 0, 0)
    thisMon.setDate(thisMon.getDate() - dow)
    const lastMon = new Date(thisMon)
    lastMon.setDate(lastMon.getDate() - 7)
    const lastSunEnd = new Date(thisMon)
    lastSunEnd.setMilliseconds(lastSunEnd.getMilliseconds() - 1)
    return { start: lastMon, end: lastSunEnd }
  }
  
  private kstWeekBoundsForPrevPrevWeek(todayKst: Date): { start: Date; end: Date } {
    const { start: lastMon } = this.kstWeekBoundsForLastWeek(todayKst)
    const prevLastMon = new Date(lastMon)
    prevLastMon.setDate(prevLastMon.getDate() - 7)
    const prevLastSunEnd = new Date(lastMon)
    prevLastSunEnd.setMilliseconds(prevLastSunEnd.getMilliseconds() - 1)
    return { start: prevLastMon, end: prevLastSunEnd }
  }
  
  private prettyKstRange(startKst: Date, endKst: Date): string {
    const s = startKst.toISOString().split('T')[0]
    const e = endKst.toISOString().split('T')[0]
    return `${s} ~ ${e} (KST)`
  }
  
  private truncate(s: string | undefined, n: number): string {
    if (!s) return '(제목 없음)'
    return s.length <= n ? s : s.substring(0, n - 1) + '…'
  }
  
  private bold(s: string): string {
    return `*${s}*`
  }
  
  private authHeaders(token: string): Record<string, string> {
    return { 'Authorization': `Bearer ${token}` }
  }
  
  private async ensureOk(response: Response): Promise<Response> {
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`HTTP ${response.status} for ${response.url}: ${text.substring(0, 800)}`)
    }
    return response
  }
  
  async generateReport(options: WeeklyReportOptions = {}): Promise<{
    executionId: string
    data: WeeklyReportData
    aiAnalysis?: AIAnalysis
  }> {
    this.executionLogs = [] // 로그 초기화
    const startTime = Date.now()
    const {
      targetWeek,
      startDate,
      endDate,
      sendSlack = true,
      triggerType = 'manual',
      isTestMode = false
    } = options

    this.log(`[1/13] 환경 로드 (${this.platform.toUpperCase()})…`)
    const token = process.env.SENTRY_AUTH_TOKEN
    const org = process.env.SENTRY_ORG_SLUG
    const projectSlug = getPlatformEnv(this.platform, 'PROJECT_SLUG')
    const environment = getPlatformEnvOrDefault(this.platform, 'SENTRY_ENVIRONMENT', 'production')
    
    if (!token || !org) {
      throw new Error('SENTRY_AUTH_TOKEN, SENTRY_ORG_SLUG 필수')
    }

    this.log('[2/13] 주간 범위 계산…')
    // 날짜 범위 계산 - Python 스크립트와 동일한 로직
    let thisWeekStart: Date, thisWeekEnd: Date
    let prevWeekStart: Date, prevWeekEnd: Date

    if (startDate && endDate) {
      thisWeekStart = startDate
      thisWeekEnd = endDate
      const weekDiff = 7 * 24 * 60 * 60 * 1000
      prevWeekStart = new Date(thisWeekStart.getTime() - weekDiff)
      prevWeekEnd = new Date(thisWeekEnd.getTime() - weekDiff)
    } else if (targetWeek) {
      const weekBounds = this.kstWeekBoundsForLastWeek(targetWeek)
      thisWeekStart = weekBounds.start
      thisWeekEnd = weekBounds.end
      
      const prevWeekBounds = this.kstWeekBoundsForPrevPrevWeek(targetWeek)
      prevWeekStart = prevWeekBounds.start
      prevWeekEnd = prevWeekBounds.end
    } else {
      const nowKst = new Date()
      const weekBounds = this.kstWeekBoundsForLastWeek(nowKst)
      thisWeekStart = weekBounds.start
      thisWeekEnd = weekBounds.end
      
      const prevWeekBounds = this.kstWeekBoundsForPrevPrevWeek(nowKst)
      prevWeekStart = prevWeekBounds.start
      prevWeekEnd = prevWeekBounds.end
    }
    
    const thisRangeLabel = this.prettyKstRange(thisWeekStart, thisWeekEnd)
    const prevRangeLabel = this.prettyKstRange(prevWeekStart, prevWeekEnd)
    this.log(`  - 지난주: ${thisRangeLabel}`)
    this.log(`  - 지지난주: ${prevRangeLabel}`)

    this.log('[3/13] 프로젝트 ID 확인…')
    const projectId = await this.resolveProjectId(token, org, projectSlug)
    
    // 실행 기록 생성
    const execution = await reportsDb.createReportExecution(
      'weekly',
      triggerType,
      thisWeekStart,
      thisWeekStart,
      thisWeekEnd,
      this.platform
    )

    try {
      // 13단계 실행 프로세스 - Python 스크립트와 동일
      
      // [4/13] 이번주 합계
      const thisSum = await this.discoverAggregates(
        token, org, projectId, environment,
        thisWeekStart.toISOString(), thisWeekEnd.toISOString()
      )
      
      // [4/13] 지지난주 합계  
      const prevSum = await this.discoverAggregates(
        token, org, projectId, environment,
        prevWeekStart.toISOString(), prevWeekEnd.toISOString()
      )
      
      // [5/13] Crash Free 주간 평균
      const { sessionsCrashFree, usersCrashFree } = await this.sessionsCrashFreeWeeklyAvg(
        token, org, projectId, environment,
        thisWeekStart.toISOString(), thisWeekEnd.toISOString()
      )
      
      // [6/13] 상위 이슈 수집
      this.log('[6/13] 상위 이슈(이벤트 Top5) 수집…')
      const topEventsThis = await this.discoverIssueTable(
        token, org, projectId, environment,
        thisWeekStart.toISOString(), thisWeekEnd.toISOString(), '-count()', 50
      )
      const topEventsPrev = await this.discoverIssueTable(
        token, org, projectId, environment,
        prevWeekStart.toISOString(), prevWeekEnd.toISOString(), '-count()', 50
      )
      this.log(`  - 이번 주 Top 후보 ${topEventsThis.length}개 / 전주 ${topEventsPrev.length}개`)
      
      // [7/13] 신규 이슈
      const newIssues = await this.newIssuesInWeek(
        token, org, projectId, environment,
        thisWeekStart.toISOString(), thisWeekEnd.toISOString()
      )
      
      // [7/13] 급증 이슈
      const surgeIssues = await this.detectWeeklySurge(
        token, org, projectId, environment,
        thisWeekStart.toISOString(), thisWeekEnd.toISOString(),
        prevWeekStart.toISOString(), prevWeekEnd.toISOString()
      )
      
      // [12/13] 최신 릴리즈에서 해소된 이슈
      const releaseFixes = await this.releaseFixesInWeek(
        token, org, projectId, environment,
        thisWeekStart.toISOString(), thisWeekEnd.toISOString()
      )
      
      // 리포트 데이터 구성 - Python 스크립트와 동일한 구조
      const reportData: WeeklyReportData = {
        this_week_range_kst: thisRangeLabel,
        prev_week_range_kst: prevRangeLabel,
        this_week: {
          events: thisSum.events,
          issues: thisSum.issues,
          users: thisSum.users,
          crash_free_sessions: sessionsCrashFree,
          crash_free_users: usersCrashFree
        },
        prev_week: {
          events: prevSum.events,
          issues: prevSum.issues,
          users: prevSum.users
        },
        top5_events: topEventsThis.slice(0, WEEKLY_TOP_LIMIT),
        prev_top_events: topEventsPrev.slice(0, WEEKLY_TOP_LIMIT),
        new_issues: newIssues,
        surge_issues: surgeIssues,
        this_week_release_fixes: releaseFixes
      }
      
      this.log(`[12/13] 결과 JSON 미리보기:`)
      this.log(JSON.stringify(reportData, null, 2))

      // AI 분석 - 주간 리포트에서는 사용하지 않음
      let aiAnalysis: AIAnalysis | undefined

      // [13/13] Slack 블록 구성 및 전송
      let slackSent = false
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

      const platformEmoji = this.platform === 'android' ? '🤖 ' : '🍎 '
      const title = `${platformEmoji}Sentry 주간 리포트 — ${thisRangeLabel}`
      const slackBlocks = this.buildWeeklyBlocks(
        reportData,
        title,
        environment,
        org,
        projectId,
        {
          start: thisWeekStart.toISOString(),
          end: thisWeekEnd.toISOString()
        }
      )

      if (sendSlack && slackWebhook) {
        try {
          const modeText = isTestMode ? '[테스트 모드] ' : ''
          this.log(`[13/13] ${modeText}Slack 전송…`)
          await this.postToSlack(slackWebhook, slackBlocks)
          slackSent = true
        } catch (error) {
          this.log(`Slack 전송 실패: ${error}`)
          throw error
        }
      } else {
        this.log(`[13/13] Slack Webhook 미설정: Slack 전송 생략`)
      }

      // 실행 완료 처리
      const executionTime = Date.now() - startTime
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

      this.log(`Weekly Report 완료: ${executionTime}ms`)

      return {
        executionId: execution.id,
        data: reportData,
        aiAnalysis
      }
    } catch (error) {
      // 실행 실패 처리
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.log(`실행 실패: ${errorMessage}`)
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

  // Python 스크립트의 resolve_project_id
  private async resolveProjectId(token: string, org: string, projectSlug?: string): Promise<number> {
    if (!projectSlug) {
      throw new Error(`${this.platform.toUpperCase()}_PROJECT_SLUG 필요합니다.`)
    }
    this.log('[3/13] 프로젝트 ID 확인 중…')
    const url = `${API_BASE}/organizations/${org}/projects/`
    const response = await this.ensureOk(
      await fetch(url, { 
        headers: this.authHeaders(token),
        signal: AbortSignal.timeout(30000)
      })
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const projects: any[] = await response.json()
    for (const p of projects) {
      if (p.slug === projectSlug) {
        const pid = parseInt(p.id)
        this.log(`[3/13] 프로젝트 '${projectSlug}' → ID=${pid}`)
        return pid
      }
    }
    throw new Error(`'${projectSlug}' 프로젝트를 찾을 수 없습니다.`)
  }
  
  // Python 스크립트의 discover_aggregates
  private async discoverAggregates(
    token: string, org: string, projectId: number, environment: string | undefined,
    startIso: string, endIso: string
  ): Promise<{ events: number; issues: number; users: number }> {
    this.log('[4/13] 주간 합계 집계(이벤트/이슈/사용자)…')
    const url = `${API_BASE}/organizations/${org}/events/`
    const query = LEVEL_QUERY + (environment ? ` environment:${environment}` : '')
    const params = new URLSearchParams({
      project: projectId.toString(),
      start: startIso,
      end: endIso,
      query: query,
      referrer: 'api.weekly.aggregates'
    })
    params.append('field', 'count()')
    params.append('field', 'count_unique(issue)')
    params.append('field', 'count_unique(user)')
    
    const response = await this.ensureOk(
      await fetch(`${url}?${params}`, { 
        headers: this.authHeaders(token),
        signal: AbortSignal.timeout(60000)
      })
    )
    const result = await response.json()
    const rows = result.data || []
    if (!rows.length) {
      this.log('  - 집계 없음 (0,0,0)')
      return { events: 0, issues: 0, users: 0 }
    }
    const row = rows[0]
    const out = {
      events: parseInt(row['count()'] || '0'),
      issues: parseInt(row['count_unique(issue)'] || '0'),
      users: parseInt(row['count_unique(user)'] || '0')
    }
    this.log(`  - events=${out.events} / issues=${out.issues} / users=${out.users}`)
    return out
  }
  
  // Python 스크립트의 sessions_crash_free_weekly_avg
  private async sessionsCrashFreeWeeklyAvg(
    token: string, org: string, projectId: number, environment: string | undefined,
    startIso: string, endIso: string
  ): Promise<{ sessionsCrashFree?: number; usersCrashFree?: number }> {
    this.log('[5/13] Crash Free(주간 평균) 집계…')
    const url = `${API_BASE}/organizations/${org}/sessions/`
    const params = new URLSearchParams({
      project: projectId.toString(),
      start: startIso,
      end: endIso,
      interval: '1d',
      referrer: 'api.weekly.sessions'
    })
    params.append('field', 'crash_free_rate(session)')
    params.append('field', 'crash_free_rate(user)')
    if (environment) {
      params.set('environment', environment)
    }
    
    try {
      const response = await this.ensureOk(
        await fetch(`${url}?${params}`, { 
          headers: this.authHeaders(token),
          signal: AbortSignal.timeout(60000)
        })
      )
      const data = await response.json()
      let days = 0
      let sumS = 0.0
      let sumU = 0.0
      
      for (const g of data.groups || []) {
        const series = g.series || {}
        if (series['crash_free_rate(session)']) {
          const arr = series['crash_free_rate(session)'] || []
          if (arr.length) {
            sumS += arr.reduce((a: number, b: number) => a + b, 0)
            days = Math.max(days, arr.length)
          }
        }
        if (series['crash_free_rate(user)']) {
          const arr = series['crash_free_rate(user)'] || []
          if (arr.length) {
            sumU += arr.reduce((a: number, b: number) => a + b, 0)
            days = Math.max(days, arr.length)
          }
        }
      }
      
      const avgS = days > 0 ? sumS / days : undefined
      const avgU = days > 0 ? sumU / days : undefined
      this.log(`  - crash_free(session)=${this.fmtPctTrunc2(avgS)} / crash_free(user)=${this.fmtPctTrunc2(avgU)}`)
      return { sessionsCrashFree: avgS, usersCrashFree: avgU }
    } catch (error) {
      this.log(`Sessions API 실패: ${error}`)
      return { sessionsCrashFree: undefined, usersCrashFree: undefined }
    }
  }
  
  private fmtPctTrunc2(v?: number): string {
    if (v === undefined) return 'N/A'
    const pct = v * 100.0
    const truncated = Math.floor(pct * 100) / 100
    return `${truncated.toFixed(2)}%`
  }
  
  // Python 스크립트의 discover_issue_table
  private async discoverIssueTable(
    token: string, org: string, projectId: number, environment: string | undefined,
    startIso: string, endIso: string, orderBy: string = '-count()', limit: number = 50
  ): Promise<WeeklyIssue[]> {
    const url = `${API_BASE}/organizations/${org}/events/`
    const query = LEVEL_QUERY + (environment ? ` environment:${environment}` : '')
    const params = new URLSearchParams({
      project: projectId.toString(),
      start: startIso,
      end: endIso,
      query: query,
      orderby: orderBy,
      per_page: Math.min(Math.max(limit, 1), 100).toString(),
      referrer: 'api.weekly.issue-table'
    })
    params.append('field', 'issue.id')
    params.append('field', 'issue')
    params.append('field', 'title')
    params.append('field', 'count()')
    params.append('field', 'count_unique(user)')
    
    const response = await this.ensureOk(
      await fetch(`${url}?${params}`, { 
        headers: this.authHeaders(token),
        signal: AbortSignal.timeout(60000)
      })
    )
    const result = await response.json()
    const rows = result.data || []
    const out: WeeklyIssue[] = []
    
    for (const row of rows.slice(0, limit)) {
      const iidNum = String(row['issue.id'] || '')
      const short = row.issue
      out.push({
        issue_id: iidNum,
        short_id: short,
        title: row.title,
        events: parseInt(row['count()'] || '0'),
        users: parseInt(row['count_unique(user)'] || '0'),
        link: iidNum ? `https://sentry.io/organizations/${org}/issues/${iidNum}/` : undefined
      })
    }
    return out
  }
  
  // Python 스크립트의 new_issues_in_week
  private async newIssuesInWeek(
    token: string, org: string, projectId: number, environment: string | undefined,
    startIso: string, endIso: string, limit: number = WEEKLY_NEW_LIMIT
  ): Promise<NewIssue[]> {
    this.log('[7/13] 주간 신규 발생 이슈 수집…')
    const q = [LEVEL_QUERY, `firstSeen:>=${startIso}`, `firstSeen:<${endIso}`]
    if (environment) {
      q.push(`environment:${environment}`)
    }
    const items = await this.issuesSearch(token, org, projectId, q.join(' '), startIso, endIso, 100)
    const out: NewIssue[] = []
    for (const it of items.slice(0, limit)) {
      const iid = it.id
      out.push({
        issue_id: iid,
        title: it.title,
        count: parseInt(it.count || '0'),
        first_seen: it.firstSeen,
        link: it.permalink || (iid ? `https://sentry.io/organizations/${org}/issues/${iid}/` : undefined)
      })
    }
    this.log(`[7/13] 신규 이슈 ${out.length}개`)
    return out
  }
  
  // Python 스크립트의 issues_search
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async issuesSearch(
    token: string, org: string, projectId: number, query: string,
    sinceIso?: string, untilIso?: string, perPage: number = 100
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any[]> {
    const url = `${API_BASE}/organizations/${org}/issues/`
    const params = new URLSearchParams({
      project: projectId.toString(),
      query: query,
      per_page: Math.min(Math.max(perPage, 1), 100).toString(),
      referrer: 'api.weekly.issues-search'
    })
    if (sinceIso) params.set('since', sinceIso)
    if (untilIso) params.set('until', untilIso)
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: any[] = []
    let cursor: string | undefined
    let pages = 0
    
    while (true) {
      pages++
      if (cursor) {
        params.set('cursor', cursor)
      }
      const response = await this.ensureOk(
        await fetch(`${url}?${params}`, { 
          headers: this.authHeaders(token),
          signal: AbortSignal.timeout(60000)
        })
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const arr: any[] = await response.json()
      out.push(...arr)
      cursor = this.parseNextCursor(response.headers.get('link') || '')
      if (!cursor || !arr.length) break
    }
    return out
  }
  
  private parseNextCursor(linkHeader: string): string | undefined {
    if (!linkHeader) return undefined
    const parts = linkHeader.split(',').map(p => p.trim())
    for (const p of parts) {
      if (!p.includes('rel="next"')) continue
      if (p.includes('results="false"')) return undefined
      const m = p.match(/cursor="([^"]+)"/)
      if (m) {
        const cur = m[1]
        if (cur.includes(':-1:')) return undefined
        return cur
      }
      const m2 = p.match(/cursor=([^;>]+)/)
      if (m2) {
        const cur = m2[1]
        if (cur.includes(':-1:')) return undefined
        return cur
      }
    }
    return undefined
  }
  
  // Python 스크립트의 detect_weekly_surge
  private async detectWeeklySurge(
    token: string, org: string, projectId: number, environment: string | undefined,
    thisStartIso: string, thisEndIso: string,
    prevStartIso: string, prevEndIso: string
  ): Promise<WeeklySurgeIssue[]> {
    this.log('[7/13] 주간 급증(서지) 이슈 탐지…')
    const thisTop = await this.discoverIssueTable(token, org, projectId, environment, thisStartIso, thisEndIso, '-count()', 100)
    const prevTop = await this.discoverIssueTable(token, org, projectId, environment, prevStartIso, prevEndIso, '-count()', 100)
    
    const thisMap = new Map(thisTop.map(x => [String(x.issue_id), x]))
    const prevMap = new Map(prevTop.map(x => [String(x.issue_id), x]))
    
    // 베이스라인: 지난 4주(전주 포함)의 weekly events
    const baselines = new Map<string, number[]>()
    const allIssueIds = new Set([...thisMap.keys(), ...prevMap.keys()])
    for (const iid of allIssueIds) {
      baselines.set(iid, [])
    }
    
    // 이번주 기준 종료일의 직전 주부터 4주 수집
    const endDt = new Date(thisEndIso)
    for (let w = 1; w <= WEEKLY_BASELINE_WEEKS; w++) {
      const wEnd = new Date(endDt.getTime() - w * 7 * 24 * 60 * 60 * 1000)
      const wStart = new Date(wEnd.getTime() - (6 * 24 * 60 * 60 * 1000 + 23 * 60 * 60 * 1000 + 59 * 60 * 1000 + 999))
      const wSIso = wStart.toISOString()
      const wEIso = wEnd.toISOString()
      const rows = await this.discoverIssueTable(token, org, projectId, environment, wSIso, wEIso, '-count()', 200)
      const wMap = new Map(rows.map(r => [String(r.issue_id), r]))
      for (const iid of baselines.keys()) {
        baselines.get(iid)!.push(parseInt(String(wMap.get(iid)?.events || 0)))
      }
    }
    
    const out: WeeklySurgeIssue[] = []
    for (const [iid, it] of thisMap) {
      const cur = parseInt(String(it.events || 0))
      if (cur < WEEKLY_SURGE_MIN_EVENTS) continue
      
      const prev = parseInt(String(prevMap.get(iid)?.events || 0))
      const growth = cur / Math.max(prev, 1)
      const baseVals = baselines.get(iid) || []
      const { m, s } = this.meanStd(baseVals.map(x => parseFloat(String(x))))
      const med = this.median(baseVals.map(x => parseFloat(String(x))))
      const mMad = this.mad(baseVals.map(x => parseFloat(String(x))), med)
      const eps = 1e-9
      const z = s > 0 ? (cur - m) / (s + eps) : (cur > m ? Number.POSITIVE_INFINITY : 0.0)
      const madS = mMad > 0 ? (cur - med) / (1.4826 * mMad + eps) : (cur > med ? Number.POSITIVE_INFINITY : 0.0)
      
      const conds = {
        growth: growth >= WEEKLY_SURGE_GROWTH_MULTIPLIER,
        zscore: isFinite(z) && z >= WEEKLY_SURGE_Z_THRESHOLD,
        madscore: isFinite(madS) && madS >= WEEKLY_SURGE_MAD_THRESHOLD
      }
      
      if (Object.values(conds).some(Boolean)) {
        out.push({
          issue_id: iid,
          title: it.title || '(제목 없음)',
          event_count: cur,
          prev_count: prev,
          growth_multiplier: Math.round(growth * 100) / 100,
          zscore: !isFinite(z) ? undefined : Math.round(z * 100) / 100,
          mad_score: !isFinite(madS) ? undefined : Math.round(madS * 100) / 100,
          link: it.link,
          reasons: Object.entries(conds)
            .filter(([, value]) => value)
            .map(([key]) => key)
        })
      }
    }
    
    out.sort((a, b) => {
      return b.event_count - a.event_count ||
             (b.zscore || 0) - (a.zscore || 0) ||
             (b.mad_score || 0) - (a.mad_score || 0) ||
             b.growth_multiplier - a.growth_multiplier
    })
    
    this.log(`[7/13] 급증 이슈 ${out.length}개`)
    return out.slice(0, WEEKLY_SURGE_LIMIT)
  }
  
  // 통계 함수들
  private meanStd(values: number[]): { m: number; s: number } {
    if (!values.length) return { m: 0.0, s: 0.0 }
    const m = values.reduce((a, b) => a + b, 0) / values.length
    const variance = values.reduce((a, v) => a + (v - m) ** 2, 0) / values.length
    return { m, s: Math.sqrt(variance) }
  }
  
  private median(values: number[]): number {
    if (!values.length) return 0.0
    const s = values.slice().sort((a, b) => a - b)
    const n = s.length
    const mid = Math.floor(n / 2)
    if (n % 2 === 1) return s[mid]
    return (s[mid - 1] + s[mid]) / 2.0
  }
  
  private mad(values: number[], med?: number): number {
    if (!values.length) return 0.0
    const m = med !== undefined ? med : this.median(values)
    const dev = values.map(v => Math.abs(v - m))
    return this.median(dev)
  }
  
  // Python 스크립트의 release_fixes_in_week
  private async releaseFixesInWeek(
    token: string, org: string, projectId: number, environment: string | undefined,
    weekStartIso: string, weekEndIso: string
  ): Promise<ReleaseFix[]> {
    this.log('[12/13] 최신 릴리즈 개선 감지 시작…')
    const bestRel = await this.latestReleaseVersion(token, org, projectId)
    if (!bestRel) {
      this.log('[12/13] 최신 릴리즈 없음')
      return []
    }
    
    this.log('[12/13] 전후 비교 대상(이벤트 Top50) 수집…')
    const topE = await this.discoverIssueTable(token, org, projectId, environment, weekStartIso, weekEndIso, '-count()', 50)
    const pool = new Map(topE.filter(it => it.issue_id).map(it => [it.issue_id, it]))
    const ids = Array.from(pool.keys())
    if (!pool.size) {
      this.log('[12/13] 비교 대상 없음')
      return [{ release: bestRel, disappeared: [], decreased: [] }]
    }
    
    const weekEndDt = new Date(weekEndIso)
    const pivot = new Date(weekEndDt.getTime() - 24 * 60 * 60 * 1000)
    const preStart = new Date(pivot.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const preEnd = pivot.toISOString()
    const postStart = new Date(pivot.getTime() + 1000).toISOString()
    const postEnd = new Date(pivot.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
    
    this.log('[12/13] 전기간 집계…')
    const preMap = await this.countForIssuesInWindow(token, org, projectId, environment, ids, preStart, preEnd)
    this.log('[12/13] 후기간 집계…')
    const postMap = await this.countForIssuesInWindow(token, org, projectId, environment, ids, postStart, postEnd)
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const disappeared: any[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const decreased: any[] = []
    
    this.log('[12/13] 전/후 비교 판정…')
    for (const iid of ids) {
      const preEv = parseInt(String(preMap.get(iid)?.events || 0))
      const postEv = parseInt(String(postMap.get(iid)?.events || 0))
      if (preEv < RELEASE_FIXES_MIN_BASE_EVENTS) continue
      
      let status: string | undefined
      try {
        status = (await this.fetchIssueDetail(token, org, iid)).status?.toLowerCase()
      } catch (error) {
        // status를 가져올 수 없는 경우 무시
      }
      
      const dropPct = preEv > 0 ? (100.0 * (preEv - postEv) / preEv) : 0.0
      
      if (postEv === 0 && status === 'resolved') {
        disappeared.push({
          issue_id: iid,
          title: pool.get(iid)?.title,
          pre_7d_events: preEv,
          post_7d_events: postEv,
          link: pool.get(iid)?.link
        })
        continue
      }
      
      if (postEv > 0 && dropPct >= RELEASE_FIX_IMPROVEMENT_DROP_PCT) {
        decreased.push({
          issue_id: iid,
          title: pool.get(iid)?.title,
          pre_7d_events: preEv,
          post_7d_events: postEv,
          delta_pct: Math.round(-dropPct * 10) / 10,
          link: pool.get(iid)?.link
        })
      }
    }
    
    disappeared.sort((a, b) => b.pre_7d_events - a.pre_7d_events)
    decreased.sort((a, b) => b.delta_pct - a.delta_pct || a.post_7d_events - b.post_7d_events)
    this.log(`[12/13] 최신 '${bestRel}' → 사라진:${disappeared.length} / 감소:${decreased.length}`)
    return [{
      release: bestRel,
      disappeared: disappeared.slice(0, WEEKLY_RELEASE_FIXES_PER_RELEASE_LIMIT),
      decreased: decreased.slice(0, WEEKLY_RELEASE_FIXES_PER_RELEASE_LIMIT)
    }]
  }
  
  // Python 스크립트의 보조 메서드들
  private async latestReleaseVersion(token: string, org: string, projectId: number): Promise<string | undefined> {
    this.log('[11/13] 최신 릴리즈(semver) 선택 시작…')
    const rels = await this.listReleasesPaginated(token, org, projectId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cands: Array<{ version: any; name: string }> = []
    
    for (const r of rels) {
      const name = String(r.version || r.shortVersion || '').trim()
      if (!name || !SEMVER_RE.test(name)) continue
      try {
        const base = name.split('+')[0]
        // 간단한 semver 파싱 (major.minor.patch)
        const parts = base.split('.').map(x => parseInt(x))
        if (parts.length === 3 && parts.every(x => !isNaN(x))) {
          cands.push({ version: parts, name })
        }
      } catch (error) {
        continue
      }
    }
    
    if (!cands.length) {
      this.log('[11/13] 정규 semver 릴리즈 없음')
      return undefined
    }
    
    // 버전 정렬 (major, minor, patch 순)
    cands.sort((a, b) => {
      for (let i = 0; i < 3; i++) {
        if (a.version[i] !== b.version[i]) {
          return b.version[i] - a.version[i]
        }
      }
      return 0
    })
    
    const best = cands[0].name
    this.log(`[11/13] 최신 릴리즈: ${best}`)
    return best
  }
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async listReleasesPaginated(
    token: string, org: string, projectId: number, perPage: number = 100, maxPages: number = 20
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any[]> {
    this.log('[10/13] 릴리즈 목록 수집 시작…')
    const url = `${API_BASE}/organizations/${org}/releases/`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: any[] = []
    let cursor: string | undefined
    let pages = 0
    
    while (true) {
      pages++
      const params = new URLSearchParams({
        project: projectId.toString(),
        per_page: Math.min(Math.max(perPage, 1), 100).toString()
      })
      if (cursor) params.set('cursor', cursor)
      
      const response = await this.ensureOk(
        await fetch(`${url}?${params}`, { 
          headers: this.authHeaders(token),
          signal: AbortSignal.timeout(60000)
        })
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any[] = await response.json()
      out.push(...data)
      this.log(`[10/13] 릴리즈 페이지 ${pages}: ${data.length}개`)
      cursor = this.parseNextCursor(response.headers.get('link') || '')
      if (!cursor || pages >= maxPages || !data.length) break
    }
    
    this.log(`[10/13] 릴리즈 총 ${out.length}개 수집 완료`)
    return out
  }
  
  private async countForIssuesInWindow(
    token: string, org: string, projectId: number, environment: string | undefined,
    issueIds: string[], startIso: string, endIso: string
  ): Promise<Map<string, { events: number; users: number }>> {
    if (!issueIds.length) return new Map()
    
    const url = `${API_BASE}/organizations/${org}/events/`
    const query = LEVEL_QUERY + (environment ? ` environment:${environment}` : '') + ` issue.id:[${issueIds.join(',')}]`
    const params = new URLSearchParams({
      project: projectId.toString(),
      start: startIso,
      end: endIso,
      query: query,
      orderby: '-count()',
      per_page: '100',
      referrer: 'api.weekly.issue-bulk-counts'
    })
    params.append('field', 'issue.id')
    params.append('field', 'count()')
    params.append('field', 'count_unique(user)')
    
    const response = await this.ensureOk(
      await fetch(`${url}?${params}`, { 
        headers: this.authHeaders(token),
        signal: AbortSignal.timeout(60000)
      })
    )
    const result = await response.json()
    const rows = result.data || []
    const out = new Map<string, { events: number; users: number }>()
    
    for (const row of rows) {
      const iid = String(row['issue.id'])
      out.set(iid, {
        events: parseInt(row['count()'] || '0'),
        users: parseInt(row['count_unique(user)'] || '0')
      })
    }
    return out
  }
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async fetchIssueDetail(token: string, org: string, issueKey: string): Promise<any> {
    if (/^\d+$/.test(issueKey)) {
      const url = `${API_BASE}/issues/${issueKey}/`
      const response = await this.ensureOk(
        await fetch(url, { 
          headers: this.authHeaders(token),
          signal: AbortSignal.timeout(30000)
        })
      )
      return response.json()
    }
    
    // shortId로 검색해서 숫자형 id로 재조회
    const searchUrl = `${API_BASE}/organizations/${org}/issues/`
    const params = new URLSearchParams({
      query: `shortId:${issueKey}`,
      per_page: '1',
      referrer: 'api.weekly.issue-detail-resolve'
    })
    
    const response = await this.ensureOk(
      await fetch(`${searchUrl}?${params}`, { 
        headers: this.authHeaders(token),
        signal: AbortSignal.timeout(30000)
      })
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arr: any[] = await response.json()
    if (!arr.length) {
      throw new Error(`이슈 shortId '${issueKey}'를 숫자형 ID로 해석할 수 없습니다.`)
    }
    const numericId = String(arr[0].id || '')
    if (!numericId) {
      throw new Error(`shortId '${issueKey}' 응답에 숫자형 id가 없습니다.`)
    }
    
    const url = `${API_BASE}/issues/${numericId}/`
    const finalResponse = await this.ensureOk(
      await fetch(url, { 
        headers: this.authHeaders(token),
        signal: AbortSignal.timeout(30000)
      })
    )
    return finalResponse.json()
  }
  
  // Python 스크립트의 post_to_slack
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async postToSlack(webhookUrl: string, blocks: any[]): Promise<void> {
    const payload = { blocks }
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000)
    })
    
    if (!response.ok) {
      const text = await response.text()
      this.log(`[Slack] Post failed ${response.status}: ${text.substring(0, 300)}`)
      throw new Error(`Slack post failed: ${response.status} - ${text.substring(0, 200)}`)
    }
    this.log('[13/13] Slack 전송 완료.')
  }
  
  // Python 스크립트의 build_weekly_blocks와 동일한 Slack 메시지 구성
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildWeeklyBlocks(
    payload: WeeklyReportData,
    slackTitle: string,
    envLabel: string | undefined,
    org: string,
    projectId: number,
    weekWindowUtc: { start: string; end: string }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): any[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks: any[] = []
    blocks.push({
      type: 'header',
      text: { type: 'plain_text', text: slackTitle, emoji: true }
    })
    
    const sumThis = payload.this_week
    const sumPrev = payload.prev_week
    
    const events = sumThis.events
    const issues = sumThis.issues
    const users = sumThis.users
    const prevEvents = sumPrev.events
    const prevIssues = sumPrev.issues
    const prevUsers = sumPrev.users
    
    const cfS = sumThis.crash_free_sessions
    const cfU = sumThis.crash_free_users
    
    const summaryLines = [
      this.bold(':memo: Summary'),
      `• 💥 *총 이벤트 발생 건수*: ${this.diffLine(events, prevEvents, '건')}`,
      `• 🐞 *유니크 이슈 개수*: ${this.diffLine(issues, prevIssues, '개')}`,
      `• 👥 *영향 사용자*: ${this.diffLine(users, prevUsers, '명')}`,
      `• 🛡️ *Crash Free 세션(주간 평균)*: ${this.fmtPctTrunc2(cfS)} / *Crash Free 사용자*: ${this.fmtPctTrunc2(cfU)}`
    ]
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: summaryLines.join('\n') } })
    
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `*집계 구간*: ${payload.this_week_range_kst}` }] })
    if (envLabel) {
      blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `*환경*: ${envLabel}` }] })
    }
    blocks.push({ type: 'divider' })
    
    const topThis = payload.top5_events || []
    const prevMap = new Map((payload.prev_top_events || []).map(x => [String(x.issue_id), x]))
    if (topThis.length) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: this.bold(':sports_medal: 상위 5개 이슈(이벤트)') } })
      const lines = topThis.slice(0, WEEKLY_TOP_LIMIT).map(x => this.issueLineWithPrev(x, prevMap))
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } })
      blocks.push({ type: 'divider' })
    }
    
    const newItems = payload.new_issues || []
    if (newItems.length) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: this.bold(':new: 주간 신규 발생 이슈') } })
      const lines = newItems.map(x => {
        const title = this.truncate(x.title, TITLE_MAX)
        const link = x.link || '#'
        const count = x.count || 0
        return `• <${link}|${title}> · ${count}건`
      })
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } })
      blocks.push({ type: 'divider' })
    }
    
    const surges = payload.surge_issues || []
    if (surges.length) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: this.bold(':chart_with_upwards_trend: 급증(서지) 이슈') } })
      const lines: string[] = []
      for (const s of surges) {
        const title = this.truncate(s.title, TITLE_MAX)
        const link = s.link || '#'
        const head = `• <${link}|${title}> · ${s.event_count}건`
        const tail = `  ↳ 전주 ${s.prev_count}건 → 이번주 ${s.event_count}건. 판정 근거: ${this.surgeReasonKo(s.reasons || [])}`
        lines.push(head + '\n' + tail)
      }
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } })
      blocks.push({ type: 'divider' })
    }
    
    const rfix = payload.this_week_release_fixes || []
    if (rfix.length) {
      const grp = rfix[0]
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: this.bold('📦 최신 릴리즈에서 해소된 이슈') } })
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: this.bold(`• ${grp.release}`) } })
      
      const disappeared = grp.disappeared || []
      const decreased = grp.decreased || []
      
      if (disappeared.length) {
        const rows = [this.bold('  ◦ 사라진 이슈(전후 7일 비교: 0건 & 현재 Resolved)')]
        for (const it of disappeared) {
          const title = this.truncate(it.title, TITLE_MAX)
          rows.push(`    • <${it.link}|${title}> — 전 7일 ${it.pre_7d_events}건 → 후 7일 0건`)
        }
        blocks.push({ type: 'section', text: { type: 'mrkdwn', text: rows.join('\n') } })
      }
      
      if (decreased.length) {
        const rows = [this.bold('  ◦ 많이 감소한 이슈(전후 7일 -80%p 이상)')]
        for (const it of decreased) {
          const title = this.truncate(it.title, TITLE_MAX)
          rows.push(`    • <${it.link}|${title}> — 전 7일 ${it.pre_7d_events}건 → 후 7일 ${it.post_7d_events}건 (${it.delta_pct}pp)`)
        }
        blocks.push({ type: 'section', text: { type: 'mrkdwn', text: rows.join('\n') } })
      }
      
      blocks.push({ type: 'divider' })
    }
    
    try {
      const actionsBlock = this.buildFooterActionsBlock(org, projectId, envLabel, weekWindowUtc)
      blocks.push(actionsBlock)
    } catch (error) {
      // 액션 블록 실패는 무시하고 계속 진행
    }
    
    return blocks
  }
  
  // Python 스크립트의 보조 함수들
  private diffLine(cur: number, prev: number, unit: string = '건'): string {
    const delta = cur - prev
    let arrow: string
    if (delta > 0) {
      arrow = ':small_red_triangle:'
    } else if (delta < 0) {
      arrow = ':small_red_triangle_down:'
    } else {
      arrow = '—'
    }
    const ratio = prev > 0 ? ` (${((delta / prev) * 100).toFixed(1)}%)` : ''
    return `${cur}${unit} -> 전주 대비: ${arrow}${Math.abs(delta)}${unit}${ratio}`
  }
  
  private issueLineWithPrev(item: WeeklyIssue, prevMap: Map<string, WeeklyIssue>): string {
    const title = this.truncate(item.title, TITLE_MAX)
    const link = item.link
    const ev = item.events
    const us = item.users
    const head = link ? `• <${link}|${title}> · ${ev}건 · ${us}명` : `• ${title} · ${ev}건 · ${us}명`
    
    const prevEv = parseInt(String(prevMap.get(String(item.issue_id))?.events || 0))
    const tail = ` -> 전주 대비: ${this.diffDeltaOnly(ev, prevEv, '건')}`
    return head + ' ' + tail
  }
  
  private diffDeltaOnly(cur: number, prev: number, unit: string = '건'): string {
    const delta = cur - prev
    let arrow: string
    if (delta > 0) {
      arrow = ':small_red_triangle:'
    } else if (delta < 0) {
      arrow = ':small_red_triangle_down:'
    } else {
      arrow = '—'
    }
    const ratio = prev > 0 ? ` (${((delta / prev) * 100).toFixed(1)}%)` : ''
    return `${arrow}${Math.abs(delta)}${unit}${ratio}`
  }
  
  private surgeReasonKo(reasons: string[]): string {
    const ko = {
      growth: '전주 대비 급증',
      zscore: '평균 대비 통계적 급증',
      madscore: '중앙값 대비 이상치'
    } as Record<string, string>
    const labeled = reasons.map(x => ko[x] || x)
    return labeled.join('/')
  }
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildFooterActionsBlock(
    org: string,
    projectId: number,
    envLabel: string | undefined,
    win: { start: string; end: string }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): any {
    const startIso = win.start
    const endIso = win.end
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
    environment: string | undefined,
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
}

export const weeklyReportService = new WeeklyReportService()
