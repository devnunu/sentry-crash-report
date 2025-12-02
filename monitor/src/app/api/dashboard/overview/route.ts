import {NextRequest, NextResponse} from 'next/server'
import {reportsDb} from '@/lib/reports/database'
import {createApiError, createApiResponse, getErrorMessage} from '@/lib/utils'
import type {DailyReportData, ReportExecution} from '@/lib/reports/types'

interface DashboardMetrics {
  overall: {
    totalEvents: number
    totalIssues: number
    criticalIssues: number
    affectedUsers: number
  }
  platforms: Array<{
    platform: 'android' | 'ios'
    totalEvents: number
    totalIssues: number
    criticalIssues: number
    affectedUsers: number
    trend: 'up' | 'down' | 'stable'
    trendPercent: number
  }>
  recentIssues: Array<{
    id: string
    title: string
    platform: 'android' | 'ios'
    severity: 'critical' | 'high' | 'medium' | 'low'
    affectedUsers: number
    events: number
    firstSeen: string
    trend: 'up' | 'down' | 'stable'
  }>
  lastUpdated: string
}

// 최근 성공한 리포트 데이터에서 메트릭 추출
function extractMetricsFromReport(report: ReportExecution): {
  events: number
  issues: number
  users: number
  criticalIssues: any[]
} {
  if (!report.result_data) {
    return { events: 0, issues: 0, users: 0, criticalIssues: [] }
  }

  const data = report.result_data as any

  if (report.report_type === 'daily') {
    const dailyData = data as DailyReportData
    const dayKey = Object.keys(dailyData).find(key => key !== 'slack_blocks' && typeof dailyData[key] === 'object')

    if (dayKey && dailyData[dayKey] && typeof dailyData[dayKey] === 'object') {
      const dayData = dailyData[dayKey] as any

      // 일간 리포트의 실제 필드명 사용
      const events = dayData.crash_events || dayData.total_events || 0
      const issues = dayData.unique_issues || dayData.issues_count || dayData.total_issues || 0
      const users = dayData.impacted_users || dayData.total_users || 0

      // Top 이슈에서 critical 찾기 (실제 필드명 사용)
      const topIssues = dayData.top_5_issues || dayData.top5_events || []
      const criticalIssues = topIssues.filter((issue: any) =>
        (issue.events || issue.event_count || 0) > 100 || (issue.users || issue.user_count || 0) > 50
      )

      return { events, issues, users, criticalIssues }
    }
  }

  return { events: 0, issues: 0, users: 0, criticalIssues: [] }
}

// 이슈 심각도 계산
function calculateSeverity(users: number, events: number): 'critical' | 'high' | 'medium' | 'low' {
  if (users > 100 || events > 500) return 'critical'
  if (users > 50 || events > 200) return 'high'
  if (users > 10 || events > 50) return 'medium'
  return 'low'
}

// 트렌드 계산 (이전 리포트와 비교)
function calculateTrend(current: number, previous: number): { trend: 'up' | 'down' | 'stable', percent: number } {
  if (previous === 0) return { trend: 'stable', percent: 0 }
  
  const change = ((current - previous) / previous) * 100
  if (Math.abs(change) < 5) return { trend: 'stable', percent: Math.abs(change) }
  
  return {
    trend: change > 0 ? 'up' : 'down',
    percent: Math.abs(change)
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const platform = searchParams.get('platform') as 'android' | 'ios' | null
    
    console.log(`[API] Fetching dashboard overview data for platform: ${platform || 'all'}`)
    
    // 플랫폼별 또는 전체 리포트 가져오기
    let androidReports: any[] = []
    let iosReports: any[] = []
    
    if (!platform || platform === 'android') {
      androidReports = await reportsDb.getReportExecutions('daily', 10, 0, 'android')
    }
    if (!platform || platform === 'ios') {
      iosReports = await reportsDb.getReportExecutions('daily', 10, 0, 'ios')
    }

    // 성공한 리포트만 필터링
    const androidSuccessReports = androidReports.filter(r => r.status === 'success' && r.result_data)
    const iosSuccessReports = iosReports.filter(r => r.status === 'success' && r.result_data)

    // 최신 리포트에서 메트릭 추출
    const androidLatest = androidSuccessReports[0]
    const iosLatest = iosSuccessReports[0]
    const androidPrevious = androidSuccessReports[1]
    const iosPrevious = iosSuccessReports[1]

    const androidMetrics = androidLatest ? extractMetricsFromReport(androidLatest) :
      { events: 0, issues: 0, users: 0, criticalIssues: [] }
    const iosMetrics = iosLatest ? extractMetricsFromReport(iosLatest) :
      { events: 0, issues: 0, users: 0, criticalIssues: [] }

    const androidPrevMetrics = androidPrevious ? extractMetricsFromReport(androidPrevious) : androidMetrics
    const iosPrevMetrics = iosPrevious ? extractMetricsFromReport(iosPrevious) : iosMetrics

    // 트렌드 계산
    const androidTrend = calculateTrend(androidMetrics.users, androidPrevMetrics.users)
    const iosTrend = calculateTrend(iosMetrics.users, iosPrevMetrics.users)

    // 플랫폼별 메트릭 계산
    const platforms = []
    let totalEvents = 0
    let totalIssues = 0
    let totalUsers = 0
    let totalCriticalIssues = 0

    if (!platform || platform === 'android') {
      platforms.push({
        platform: 'android' as const,
        totalEvents: androidMetrics.events,
        totalIssues: androidMetrics.issues,
        criticalIssues: androidMetrics.criticalIssues.length,
        affectedUsers: androidMetrics.users,
        trend: androidTrend.trend,
        trendPercent: Math.round(androidTrend.percent * 10) / 10
      })
      totalEvents += androidMetrics.events
      totalIssues += androidMetrics.issues
      totalUsers += androidMetrics.users
      totalCriticalIssues += androidMetrics.criticalIssues.length
    }

    if (!platform || platform === 'ios') {
      platforms.push({
        platform: 'ios' as const,
        totalEvents: iosMetrics.events,
        totalIssues: iosMetrics.issues,
        criticalIssues: iosMetrics.criticalIssues.length,
        affectedUsers: iosMetrics.users,
        trend: iosTrend.trend,
        trendPercent: Math.round(iosTrend.percent * 10) / 10
      })
      totalEvents += iosMetrics.events
      totalIssues += iosMetrics.issues
      totalUsers += iosMetrics.users
      totalCriticalIssues += iosMetrics.criticalIssues.length
    }

    // 최근 중요 이슈들 추출
    const recentIssues: any[] = []
    
    // Android 이슈들
    if ((!platform || platform === 'android') && androidLatest && androidLatest.result_data) {
      const data = androidLatest.result_data as any
      let issues: any[] = []

      const dayKey = Object.keys(data).find(key => key !== 'slack_blocks')
      if (dayKey && data[dayKey]?.top5_events) {
        issues = data[dayKey].top5_events
      }

      issues.slice(0, 5).forEach((issue, idx) => {
        const events = issue.events || issue.event_count || 0
        const users = issue.users || 0
        recentIssues.push({
          id: issue.issue_id || `android-${idx}`,
          title: issue.title || '알 수 없는 오류',
          platform: 'android' as const,
          severity: calculateSeverity(users, events),
          affectedUsers: users,
          events,
          firstSeen: androidLatest.created_at,
          trend: Math.random() > 0.5 ? 'up' : 'stable' // 실제로는 이전 데이터와 비교
        })
      })
    }

    // iOS 이슈들
    if ((!platform || platform === 'ios') && iosLatest && iosLatest.result_data) {
      const data = iosLatest.result_data as any
      let issues: any[] = []

      const dayKey = Object.keys(data).find(key => key !== 'slack_blocks')
      if (dayKey && data[dayKey]?.top5_events) {
        issues = data[dayKey].top5_events
      }

      issues.slice(0, 5).forEach((issue, idx) => {
        const events = issue.events || issue.event_count || 0
        const users = issue.users || 0
        recentIssues.push({
          id: issue.issue_id || `ios-${idx}`,
          title: issue.title || '알 수 없는 오류',
          platform: 'ios' as const,
          severity: calculateSeverity(users, events),
          affectedUsers: users,
          events,
          firstSeen: iosLatest.created_at,
          trend: Math.random() > 0.5 ? 'up' : 'stable'
        })
      })
    }

    // Critical 이슈 우선 정렬
    recentIssues.sort((a, b) => {
      const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 }
      return severityOrder[b.severity] - severityOrder[a.severity]
    })

    // 최신 리포트 날짜 찾기
    let latestReportDate = ''
    if (androidLatest && iosLatest) {
      const androidDate = androidLatest.target_date || androidLatest.created_at.split('T')[0]
      const iosDate = iosLatest.target_date || iosLatest.created_at.split('T')[0]
      latestReportDate = androidDate > iosDate ? androidDate : iosDate
    } else if (androidLatest) {
      latestReportDate = androidLatest.target_date || androidLatest.created_at.split('T')[0]
    } else if (iosLatest) {
      latestReportDate = iosLatest.target_date || iosLatest.created_at.split('T')[0]
    }

    const dashboardData: DashboardMetrics = {
      overall: {
        totalEvents,
        totalIssues,
        criticalIssues: totalCriticalIssues,
        affectedUsers: totalUsers
      },
      platforms,
      recentIssues: recentIssues.slice(0, 10),
      lastUpdated: latestReportDate ? `${latestReportDate}T00:00:00Z` : new Date().toISOString()
    }

    return NextResponse.json(createApiResponse(dashboardData))
  } catch (error) {
    console.error('[API] Failed to fetch dashboard overview:', error)
    
    return NextResponse.json(
      createApiError(getErrorMessage(error)),
      { status: 500 }
    )
  }
}