import { NextRequest, NextResponse } from 'next/server'
import { reportsDb } from '@/lib/reports/database'
import { createApiResponse, createApiError, getErrorMessage } from '@/lib/utils'
import type { ReportExecution, DailyReportData, WeeklyReportData } from '@/lib/reports/types'

interface TrendData {
  date: string
  android: {
    events: number
    issues: number
    users: number
    crashFreeRate: number
  }
  ios: {
    events: number
    issues: number
    users: number
    crashFreeRate: number
  }
  total: {
    events: number
    issues: number
    users: number
    crashFreeRate: number
  }
}

function extractMetricsFromReport(report: ReportExecution): {
  events: number
  issues: number
  users: number
  crashFreeRate: number
} {
  if (!report.result_data) {
    console.log(`[extractMetrics] No result_data for report ${report.id}`)
    return { events: 0, issues: 0, users: 0, crashFreeRate: 100 }
  }

  const data = report.result_data as any
  console.log(`[extractMetrics] Report ${report.id} type: ${report.report_type}`)

  if (report.report_type === 'daily') {
    const dailyData = data as DailyReportData
    const dayKey = Object.keys(dailyData).find(key => key !== 'slack_blocks' && typeof dailyData[key] === 'object')
    console.log(`[extractMetrics] Daily data keys:`, Object.keys(dailyData))
    console.log(`[extractMetrics] Found dayKey:`, dayKey)
    
    if (dayKey && dailyData[dayKey] && typeof dailyData[dayKey] === 'object') {
      const dayData = dailyData[dayKey] as any
      console.log(`[extractMetrics] Day data:`, dayData)
      
      // 일간 리포트의 실제 필드명 사용
      const events = dayData.crash_events || dayData.total_events || 0
      const issues = dayData.unique_issues || dayData.issues_count || dayData.total_issues || 0
      const users = dayData.impacted_users || dayData.total_users || 0
      const crashFree = dayData.crash_free_sessions_pct 
        ? (dayData.crash_free_sessions_pct <= 1 ? dayData.crash_free_sessions_pct * 100 : dayData.crash_free_sessions_pct)
        : dayData.crash_free_sessions || 100
      
      const result = { events, issues, users, crashFreeRate: crashFree }
      console.log(`[extractMetrics] Extracted metrics:`, result)
      return result
    }
  } else if (report.report_type === 'weekly') {
    const weeklyData = data as WeeklyReportData
    const thisWeek = weeklyData.this_week
    console.log(`[extractMetrics] Weekly this_week:`, thisWeek)
    
    if (thisWeek) {
      const result = {
        events: thisWeek.events || 0,
        issues: thisWeek.issues || 0,
        users: thisWeek.users || 0,
        crashFreeRate: thisWeek.crash_free_sessions || 100
      }
      console.log(`[extractMetrics] Extracted weekly metrics:`, result)
      return result
    }
  }

  console.log(`[extractMetrics] Returning default values for report ${report.id}`)
  return { events: 0, issues: 0, users: 0, crashFreeRate: 100 }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const days = parseInt(searchParams.get('days') || '7')
    const platform = searchParams.get('platform') as 'android' | 'ios' | null
    const limitPerPlatform = Math.min(days, 30) // 최대 30일

    console.log(`[API] Fetching trend data for ${days} days, platform: ${platform || 'all'}`)
    
    // 플랫폼별 또는 전체 리포트 가져오기
    let androidReports: any[] = []
    let iosReports: any[] = []
    
    if (!platform || platform === 'android') {
      androidReports = await reportsDb.getReportExecutions('daily', limitPerPlatform, 0, 'android')
    }
    if (!platform || platform === 'ios') {
      iosReports = await reportsDb.getReportExecutions('daily', limitPerPlatform, 0, 'ios')
    }

    console.log(`[API] Android reports: ${androidReports.length}, iOS reports: ${iosReports.length}`)

    // 성공한 리포트만 필터링
    const androidSuccessReports = androidReports.filter(r => r.status === 'success' && r.result_data)
    const iosSuccessReports = iosReports.filter(r => r.status === 'success' && r.result_data)
    
    console.log(`[API] Android success reports: ${androidSuccessReports.length}, iOS success reports: ${iosSuccessReports.length}`)

    // 날짜별로 그룹화
    const dateMap = new Map<string, { android?: any, ios?: any }>()

    // Android 데이터 처리
    androidSuccessReports.forEach(report => {
      const date = report.target_date || report.created_at.split('T')[0]
      const metrics = extractMetricsFromReport(report)
      console.log(`[API] Android ${date}:`, metrics)
      if (!dateMap.has(date)) {
        dateMap.set(date, {})
      }
      dateMap.get(date)!.android = metrics
    })

    // iOS 데이터 처리
    iosSuccessReports.forEach(report => {
      const date = report.target_date || report.created_at.split('T')[0]
      const metrics = extractMetricsFromReport(report)
      console.log(`[API] iOS ${date}:`, metrics)
      if (!dateMap.has(date)) {
        dateMap.set(date, {})
      }
      dateMap.get(date)!.ios = metrics
    })

    // 요청된 일수만큼 정확히 생성하기 위해 모든 날짜를 먼저 생성
    const today = new Date()
    const allDates: string[] = []
    
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today)
      date.setDate(date.getDate() - i)
      allDates.push(date.toISOString().split('T')[0])
    }
    
    // 각 날짜에 대해 데이터 생성
    const trendData: TrendData[] = allDates.map(date => {
      const platforms = dateMap.get(date) || {}
      const android = platforms.android || { events: 0, issues: 0, users: 0, crashFreeRate: 100 }
      const ios = platforms.ios || { events: 0, issues: 0, users: 0, crashFreeRate: 100 }
      
      // 전체 총계 계산
      const total = {
        events: android.events + ios.events,
        issues: android.issues + ios.issues,
        users: android.users + ios.users,
        crashFreeRate: android.users + ios.users > 0 
          ? (android.crashFreeRate * android.users + ios.crashFreeRate * ios.users) / (android.users + ios.users)
          : 100
      }

      return {
        date,
        android,
        ios,
        total
      }
    })

    // 이제 모든 날짜가 정확히 생성되었으므로 추가 로직 불필요

    console.log(`[API] Final trend data (${trendData.length} entries):`, trendData)
    return NextResponse.json(createApiResponse(trendData))
  } catch (error) {
    console.error('[API] Failed to fetch trend data:', error)
    
    return NextResponse.json(
      createApiError(getErrorMessage(error)),
      { status: 500 }
    )
  }
}