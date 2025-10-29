import { NextRequest, NextResponse } from 'next/server'
import { DailyReportService } from '@/lib/reports/daily-report'
import type { Platform } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const platform = searchParams.get('platform') as Platform
    const targetDate = searchParams.get('targetDate')

    if (!platform || !['android', 'ios'].includes(platform)) {
      return NextResponse.json(
        { success: false, error: 'Invalid platform parameter' },
        { status: 400 }
      )
    }

    if (!targetDate) {
      return NextResponse.json(
        { success: false, error: 'targetDate parameter is required' },
        { status: 400 }
      )
    }

    // DailyReportService 인스턴스 생성
    const service = new DailyReportService(platform)

    // 최근 7일 데이터 조회
    const data = await service.getLast7DaysData(targetDate)

    return NextResponse.json({
      success: true,
      data
    })
  } catch (error) {
    console.error('Chart data fetch error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch chart data'
      },
      { status: 500 }
    )
  }
}
