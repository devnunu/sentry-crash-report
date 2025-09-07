import { sentryService } from '../sentry'
import { aiAnalysisService } from './ai-analysis'
import { reportsDb } from './database'
import { 
  getLastWeekBounds, 
  getKSTWeekBounds, 
  formatKSTDate,
  formatKSTRange,
  mean,
  std,
  median,
  mad,
  calculateZScore,
  calculateMADScore
} from './utils'
import type { 
  WeeklyReportData, 
  WeeklyIssue, 
  NewIssue, 
  WeeklySurgeIssue, 
  ReleaseFix,
  AIAnalysis 
} from './types'

export interface WeeklyReportOptions {
  targetWeek?: Date // 월요일 날짜
  startDate?: Date
  endDate?: Date
  sendSlack?: boolean
  includeAI?: boolean
  triggerType?: 'scheduled' | 'manual'
}

export class WeeklyReportService {
  
  async generateReport(options: WeeklyReportOptions = {}): Promise<{
    executionId: string
    data: WeeklyReportData
    aiAnalysis?: AIAnalysis
  }> {
    const startTime = Date.now()
    const {
      targetWeek,
      startDate,
      endDate,
      sendSlack = true,
      includeAI = true,
      triggerType = 'manual'
    } = options

    // 날짜 범위 계산
    let thisWeekStart: Date, thisWeekEnd: Date
    let prevWeekStart: Date, prevWeekEnd: Date

    if (startDate && endDate) {
      thisWeekStart = startDate
      thisWeekEnd = endDate
      // 이전 주는 7일 전으로 계산
      const weekDiff = 7 * 24 * 60 * 60 * 1000
      prevWeekStart = new Date(thisWeekStart.getTime() - weekDiff)
      prevWeekEnd = new Date(thisWeekEnd.getTime() - weekDiff)
    } else if (targetWeek) {
      const weekBounds = getKSTWeekBounds(targetWeek)
      thisWeekStart = weekBounds.start
      thisWeekEnd = weekBounds.end
      
      const prevWeek = new Date(targetWeek.getTime() - 7 * 24 * 60 * 60 * 1000)
      const prevWeekBounds = getKSTWeekBounds(prevWeek)
      prevWeekStart = prevWeekBounds.start
      prevWeekEnd = prevWeekBounds.end
    } else {
      // 기본값: 지난주
      const lastWeek = getLastWeekBounds()
      thisWeekStart = lastWeek.start
      thisWeekEnd = lastWeek.end
      
      // 지지난주
      const weekBefore = new Date(thisWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000)
      const weekBeforeBounds = getKSTWeekBounds(weekBefore)
      prevWeekStart = weekBeforeBounds.start
      prevWeekEnd = weekBeforeBounds.end
    }

    // 실행 기록 생성
    const execution = await reportsDb.createReportExecution(
      'weekly',
      triggerType,
      thisWeekStart, // target_date
      thisWeekStart,
      thisWeekEnd
    )

    try {
      console.log(`[Weekly Report] Analyzing ${formatKSTRange(thisWeekStart, thisWeekEnd)}`)
      
      // 이번 주 데이터 수집
      const thisWeekData = await this.collectWeekData(thisWeekStart, thisWeekEnd)
      
      // 지난 주 데이터 수집 (비교용)
      const prevWeekData = await this.collectWeekData(prevWeekStart, prevWeekEnd, false)
      
      // 신규 이슈
      const newIssues = await this.getNewIssues(thisWeekStart, thisWeekEnd)
      
      // 급증 이슈 탐지
      const surgeIssues = await this.detectWeeklySurgeIssues(
        thisWeekStart, thisWeekEnd,
        prevWeekStart, prevWeekEnd
      )
      
      // 릴리즈 개선 분석
      const releaseFixes = await this.analyzeReleaseFixes(thisWeekStart, thisWeekEnd)
      
      // 리포트 데이터 구성
      const reportData: WeeklyReportData = {
        this_week_range_kst: formatKSTRange(thisWeekStart, thisWeekEnd),
        prev_week_range_kst: formatKSTRange(prevWeekStart, prevWeekEnd),
        this_week: {
          events: thisWeekData.aggregation.events,
          issues: thisWeekData.aggregation.issues,
          users: thisWeekData.aggregation.users,
          crash_free_sessions: thisWeekData.crashFreeSessions,
          crash_free_users: thisWeekData.crashFreeUsers
        },
        prev_week: {
          events: prevWeekData.aggregation.events,
          issues: prevWeekData.aggregation.issues,
          users: prevWeekData.aggregation.users
        },
        top5_events: thisWeekData.topIssues,
        prev_top_events: prevWeekData.topIssues,
        new_issues: newIssues,
        surge_issues: surgeIssues,
        this_week_release_fixes: releaseFixes
      }

      // AI 분석
      let aiAnalysis: AIAnalysis | undefined
      if (includeAI && process.env.OPENAI_API_KEY) {
        try {
          console.log('[Weekly Report] Generating AI analysis')
          aiAnalysis = await aiAnalysisService.generateWeeklyAdvice(
            reportData,
            process.env.SENTRY_ENVIRONMENT
          )
        } catch (error) {
          console.error('[Weekly Report] AI analysis failed:', error)
        }
      }

      // Slack 전송
      let slackSent = false
      if (sendSlack && process.env.SLACK_WEBHOOK_URL) {
        try {
          console.log('[Weekly Report] Sending Slack notification')
          await this.sendSlackReport(reportData, aiAnalysis)
          slackSent = true
        } catch (error) {
          console.error('[Weekly Report] Slack sending failed:', error)
        }
      }

      // 실행 완료 처리
      const executionTime = Date.now() - startTime
      await reportsDb.completeReportExecution(
        execution.id,
        'success',
        reportData,
        aiAnalysis,
        slackSent,
        undefined,
        executionTime
      )

      console.log(`[Weekly Report] Completed in ${executionTime}ms`)

      return {
        executionId: execution.id,
        data: reportData,
        aiAnalysis
      }
    } catch (error) {
      // 실행 실패 처리
      const errorMessage = error instanceof Error ? error.message : String(error)
      await reportsDb.completeReportExecution(
        execution.id,
        'error',
        undefined,
        undefined,
        false,
        errorMessage,
        Date.now() - startTime
      )
      
      console.error('[Weekly Report] Failed:', error)
      throw error
    }
  }

  private async collectWeekData(
    startTime: Date,
    endTime: Date,
    includeDetails: boolean = true
  ): Promise<{
    aggregation: { events: number; issues: number; users: number }
    crashFreeSessions?: number
    crashFreeUsers?: number
    topIssues: WeeklyIssue[]
  }> {
    // 기본 집계
    const aggregation = await sentryService.getWindowAggregates(
      '', // 모든 릴리즈
      startTime,
      endTime
    )

    // Crash Free 비율 (주간 평균)
    // TODO: Sessions API 구현 필요

    let topIssues: WeeklyIssue[] = []
    
    if (includeDetails) {
      // 상위 이슈 (이벤트 기준)
      const sentryTopIssues = await sentryService.getTopIssues(
        '', // 모든 릴리즈
        startTime,
        endTime,
        50 // 더 많이 가져와서 분석에 활용
      )

      topIssues = sentryTopIssues.map(issue => ({
        issue_id: issue.issue_id,
        short_id: issue.issue_id, // TODO: shortId 매핑 필요
        title: issue.title || '(제목 없음)',
        events: issue.event_count || 0,
        users: 0, // TODO: 사용자 수 매핑 필요
        link: issue.link
      }))
    }

    return {
      aggregation,
      crashFreeSessions: undefined, // TODO: 구현
      crashFreeUsers: undefined, // TODO: 구현
      topIssues
    }
  }

  private async getNewIssues(startTime: Date, endTime: Date): Promise<NewIssue[]> {
    // TODO: Issues API로 firstSeen 기반 신규 이슈 검색 구현 필요
    // Python 코드의 new_issues_in_week 함수 참조
    return []
  }

  private async detectWeeklySurgeIssues(
    thisWeekStart: Date, thisWeekEnd: Date,
    prevWeekStart: Date, prevWeekEnd: Date
  ): Promise<WeeklySurgeIssue[]> {
    const WEEKLY_SURGE_MIN_EVENTS = 50
    const WEEKLY_SURGE_GROWTH_MULTIPLIER = 2.0
    const WEEKLY_SURGE_Z_THRESHOLD = 2.0
    const WEEKLY_SURGE_MAD_THRESHOLD = 3.5
    const WEEKLY_BASELINE_WEEKS = 4

    try {
      // 이번 주와 지난 주 상위 이슈 수집
      const thisWeekIssues = await sentryService.getTopIssues('', thisWeekStart, thisWeekEnd, 100)
      const prevWeekIssues = await sentryService.getTopIssues('', prevWeekStart, prevWeekEnd, 100)
      
      const thisWeekMap = new Map(thisWeekIssues.map(issue => [issue.issue_id, issue]))
      const prevWeekMap = new Map(prevWeekIssues.map(issue => [issue.issue_id, issue]))

      const results: WeeklySurgeIssue[] = []

      // 베이스라인 수집 (지난 4주)
      const baselineData = new Map<string, number[]>()
      
      for (const [issueId, issue] of thisWeekMap) {
        const currentCount = issue.event_count || 0
        
        if (currentCount < WEEKLY_SURGE_MIN_EVENTS) {
          continue
        }

        const prevCount = prevWeekMap.get(issueId)?.event_count || 0
        const growth = currentCount / Math.max(prevCount, 1)

        // 베이스라인 데이터 수집 (과거 4주)
        const baselineCounts: number[] = []
        for (let i = 1; i <= WEEKLY_BASELINE_WEEKS; i++) {
          const weekStart = new Date(thisWeekEnd.getTime() - i * 7 * 24 * 60 * 60 * 1000)
          const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000 + 23 * 60 * 60 * 1000 + 59 * 60 * 1000 + 59 * 1000)
          
          // TODO: 특정 이슈의 주간 이벤트 수 조회 필요
          // 임시로 이전 주 데이터 사용
          if (i === 1) {
            baselineCounts.push(prevCount)
          } else {
            baselineCounts.push(0)
          }
        }

        // 통계 계산
        const meanVal = mean(baselineCounts)
        const stdVal = std(baselineCounts)
        const medianVal = median(baselineCounts)
        const madVal = mad(baselineCounts, medianVal)

        const zScore = calculateZScore(currentCount, meanVal, stdVal)
        const madScore = calculateMADScore(currentCount, medianVal, madVal)

        // 급증 조건 판정
        const conditions = {
          growth: growth >= WEEKLY_SURGE_GROWTH_MULTIPLIER,
          zscore: !isFinite(zScore) ? false : zScore >= WEEKLY_SURGE_Z_THRESHOLD,
          madscore: !isFinite(madScore) ? false : madScore >= WEEKLY_SURGE_MAD_THRESHOLD
        }

        if (Object.values(conditions).some(Boolean)) {
          results.push({
            issue_id: issueId,
            title: issue.title || '(제목 없음)',
            event_count: currentCount,
            prev_count: prevCount,
            growth_multiplier: Math.round(growth * 100) / 100,
            zscore: !isFinite(zScore) ? undefined : Math.round(zScore * 100) / 100,
            mad_score: !isFinite(madScore) ? undefined : Math.round(madScore * 100) / 100,
            link: issue.link,
            reasons: Object.entries(conditions)
              .filter(([_, value]) => value)
              .map(([key, _]) => key)
          })
        }
      }

      // 정렬 및 상위 결과 반환
      results.sort((a, b) => {
        return b.event_count - a.event_count ||
               (b.zscore || 0) - (a.zscore || 0) ||
               (b.mad_score || 0) - (a.mad_score || 0) ||
               b.growth_multiplier - a.growth_multiplier
      })

      return results.slice(0, 10)
    } catch (error) {
      console.error('[Weekly Report] Surge detection failed:', error)
      return []
    }
  }

  private async analyzeReleaseFixes(startTime: Date, endTime: Date): Promise<ReleaseFix[]> {
    // TODO: 최신 릴리즈 분석 및 개선된 이슈 탐지 구현
    // Python 코드의 release_fixes_in_week 함수 참조
    return []
  }

  private async sendSlackReport(
    reportData: WeeklyReportData,
    aiAnalysis?: AIAnalysis
  ): Promise<void> {
    // Slack 블록 구성
    const blocks = this.buildSlackBlocks(reportData, aiAnalysis)
    
    // SLACK_WEBHOOK_URL을 직접 사용
    const webhookUrl = process.env.SLACK_WEBHOOK_URL
    if (!webhookUrl) {
      throw new Error('SLACK_WEBHOOK_URL environment variable is required')
    }
    
    // Slack 전송
    await this.postToSlack(webhookUrl, blocks)
  }

  private async postToSlack(webhookUrl: string, blocks: any[]): Promise<void> {
    const payload = { blocks }
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 30000
    })

    if (!response.ok) {
      const text = await response.text()
      console.log(`[Slack] Weekly report post failed ${response.status}: ${text.substring(0, 300)}`)
      throw new Error(`Slack post failed: ${response.status} - ${text.substring(0, 200)}`)
    }
  }

  private buildSlackBlocks(reportData: WeeklyReportData, aiAnalysis?: AIAnalysis): any[] {
    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `📊 Sentry 주간 리포트 — ${reportData.this_week_range_kst}`,
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            '*📈 주간 요약*',
            `• 💥 *총 이벤트*: ${reportData.this_week.events}건`,
            `• 🐞 *유니크 이슈*: ${reportData.this_week.issues}개`,
            `• 👥 *영향 사용자*: ${reportData.this_week.users}명`,
            reportData.this_week.crash_free_sessions !== undefined
              ? `• 🛡️ *Crash Free 세션*: ${(reportData.this_week.crash_free_sessions * 100).toFixed(2)}%`
              : null,
            reportData.this_week.crash_free_users !== undefined
              ? `• 🛡️ *Crash Free 사용자*: ${(reportData.this_week.crash_free_users * 100).toFixed(2)}%`
              : null
          ].filter(Boolean).join('\n')
        }
      }
    ]

    // 전주 대비 변화
    const eventsDelta = reportData.this_week.events - reportData.prev_week.events
    const issuesDelta = reportData.this_week.issues - reportData.prev_week.issues
    const usersDelta = reportData.this_week.users - reportData.prev_week.users

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          '*📊 전주 대비*',
          `• 이벤트: ${eventsDelta > 0 ? '+' : ''}${eventsDelta}건`,
          `• 이슈: ${issuesDelta > 0 ? '+' : ''}${issuesDelta}개`,
          `• 사용자: ${usersDelta > 0 ? '+' : ''}${usersDelta}명`
        ].join('\n')
      }
    })

    // AI 분석 추가
    if (aiAnalysis && aiAnalysis.newsletter_summary) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🤖 AI 분석*\n> ${aiAnalysis.newsletter_summary}`
        }
      })
    }

    // 상위 이슈
    if (reportData.top5_events.length > 0) {
      const issueLines = reportData.top5_events.slice(0, 5).map(issue =>
        `• <${issue.link || '#'}|${issue.title}> · ${issue.events}건 · ${issue.users}명`
      )
      
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🏆 주간 상위 5개 이슈*\n${issueLines.join('\n')}`
        }
      })
    }

    // 신규 이슈
    if (reportData.new_issues.length > 0) {
      const newIssueLines = reportData.new_issues.slice(0, 5).map(issue =>
        `• <${issue.link || '#'}|${issue.title}> · ${issue.count || issue.event_count}건`
      )
      
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*🆕 주간 신규 이슈*\n${newIssueLines.join('\n')}`
        }
      })
    }

    // 급증 이슈
    if (reportData.surge_issues.length > 0) {
      const surgeLines = reportData.surge_issues.slice(0, 5).map(issue =>
        `• <${issue.link || '#'}|${issue.title}> · ${issue.event_count}건 (전주: ${issue.prev_count}건)`
      )
      
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*📈 급증 이슈*\n${surgeLines.join('\n')}`
        }
      })
    }

    return blocks
  }
}

export const weeklyReportService = new WeeklyReportService()