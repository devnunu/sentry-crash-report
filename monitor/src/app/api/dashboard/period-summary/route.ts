import { NextRequest, NextResponse } from 'next/server'
import { createApiResponse, createApiError } from '@/lib/utils'

interface PeriodSummary {
  crashFreeRate: number
  totalEvents: number
  totalIssues: number
  criticalIssues: number
  affectedUsers: number
  dateRange: string
  reportCount: number
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const days = parseInt(searchParams.get('days') || '7')
    const platform = searchParams.get('platform') || 'all'

    // 날짜 범위 계산
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(endDate.getDate() - days)

    console.log(`[API] Fetching period summary for ${platform} platform, ${days} days`)

    // trends API에서 데이터 가져오기
    const trendsResponse = await fetch(`${request.nextUrl.origin}/api/dashboard/trends?days=${days}&platform=${platform}`)
    
    if (!trendsResponse.ok) {
      throw new Error('Failed to fetch trends data')
    }

    const trendsResult = await trendsResponse.json()
    
    if (!trendsResult.success || !trendsResult.data) {
      throw new Error('No trends data available')
    }

    const trendData = trendsResult.data

    // 플랫폼별 집계 계산
    let summary: PeriodSummary

    if (platform === 'android') {
      const androidData = trendData.map((d: any) => d.android).filter((d: any) => d.crashFreeRate > 0)
      
      if (androidData.length === 0) {
        throw new Error('No Android data available for the selected period')
      }

      const totalEvents = trendData.reduce((sum: number, d: any) => sum + d.android.events, 0)
      const totalIssues = trendData.reduce((sum: number, d: any) => sum + d.android.issues, 0)
      const totalUsers = trendData.reduce((sum: number, d: any) => sum + d.android.users, 0)
      const avgCrashFreeRate = androidData.reduce((sum: number, d: any) => sum + d.crashFreeRate, 0) / androidData.length

      // Critical 이슈는 별도 API에서 가져와야 하므로 임시로 0으로 설정
      const criticalIssues = 0

      const firstDate = trendData[0]?.date
      const lastDate = trendData[trendData.length - 1]?.date
      const dateRange = firstDate && lastDate ? 
        `${new Date(firstDate).toLocaleDateString('ko-KR')} ~ ${new Date(lastDate).toLocaleDateString('ko-KR')}` : 
        ''

      summary = {
        crashFreeRate: Number(avgCrashFreeRate.toFixed(2)),
        totalEvents,
        totalIssues,
        criticalIssues,
        affectedUsers: totalUsers,
        dateRange,
        reportCount: trendData.length
      }
    } else if (platform === 'ios') {
      const iosData = trendData.map((d: any) => d.ios).filter((d: any) => d.crashFreeRate > 0)
      
      if (iosData.length === 0) {
        throw new Error('No iOS data available for the selected period')
      }

      const totalEvents = trendData.reduce((sum: number, d: any) => sum + d.ios.events, 0)
      const totalIssues = trendData.reduce((sum: number, d: any) => sum + d.ios.issues, 0)
      const totalUsers = trendData.reduce((sum: number, d: any) => sum + d.ios.users, 0)
      const avgCrashFreeRate = iosData.reduce((sum: number, d: any) => sum + d.crashFreeRate, 0) / iosData.length

      const criticalIssues = 0

      const firstDate = trendData[0]?.date
      const lastDate = trendData[trendData.length - 1]?.date
      const dateRange = firstDate && lastDate ? 
        `${new Date(firstDate).toLocaleDateString('ko-KR')} ~ ${new Date(lastDate).toLocaleDateString('ko-KR')}` : 
        ''

      summary = {
        crashFreeRate: Number(avgCrashFreeRate.toFixed(2)),
        totalEvents,
        totalIssues,
        criticalIssues,
        affectedUsers: totalUsers,
        dateRange,
        reportCount: trendData.length
      }
    } else {
      // 통합 데이터
      const allData = trendData.map((d: any) => ({
        crashFreeRate: (d.android.crashFreeRate + d.ios.crashFreeRate) / 2,
        events: d.android.events + d.ios.events,
        issues: d.android.issues + d.ios.issues,
        users: d.android.users + d.ios.users
      })).filter((d: any) => d.crashFreeRate > 0)
      
      if (allData.length === 0) {
        throw new Error('No data available for the selected period')
      }

      const totalEvents = allData.reduce((sum: number, d: any) => sum + d.events, 0)
      const totalIssues = allData.reduce((sum: number, d: any) => sum + d.issues, 0)
      const totalUsers = allData.reduce((sum: number, d: any) => sum + d.users, 0)
      const avgCrashFreeRate = allData.reduce((sum: number, d: any) => sum + d.crashFreeRate, 0) / allData.length

      const criticalIssues = 0

      const firstDate = trendData[0]?.date
      const lastDate = trendData[trendData.length - 1]?.date
      const dateRange = firstDate && lastDate ? 
        `${new Date(firstDate).toLocaleDateString('ko-KR')} ~ ${new Date(lastDate).toLocaleDateString('ko-KR')}` : 
        ''

      summary = {
        crashFreeRate: Number(avgCrashFreeRate.toFixed(2)),
        totalEvents,
        totalIssues,
        criticalIssues,
        affectedUsers: totalUsers,
        dateRange,
        reportCount: trendData.length
      }
    }

    console.log(`[API] Period summary calculated:`, summary)

    return NextResponse.json(createApiResponse(summary))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error occurred'
    console.error('[API] Failed to fetch period summary:', error)
    
    return NextResponse.json(
      createApiError(message),
      { status: 500 }
    )
  }
}