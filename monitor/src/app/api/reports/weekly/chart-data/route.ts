import { NextRequest, NextResponse } from 'next/server'
import { DailyReportService } from '@/lib/reports/daily-report'
import type { Platform } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const platform = searchParams.get('platform') as Platform
    const endDate = searchParams.get('endDate')

    if (!platform || !['android', 'ios'].includes(platform)) {
      return NextResponse.json(
        { success: false, error: 'Invalid platform parameter' },
        { status: 400 }
      )
    }

    if (!endDate) {
      return NextResponse.json(
        { success: false, error: 'endDate parameter is required' },
        { status: 400 }
      )
    }

    // DailyReportService 인스턴스 생성
    const service = new DailyReportService(platform)

    // 주간 범위의 마지막 날짜를 기준으로 7일 데이터 조회
    const data = await service.getLast7DaysData(endDate)

    return NextResponse.json({
      success: true,
      data
    })
  } catch (error) {
    console.error('Weekly chart data fetch error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch weekly chart data'
      },
      { status: 500 }
    )
  }
}
