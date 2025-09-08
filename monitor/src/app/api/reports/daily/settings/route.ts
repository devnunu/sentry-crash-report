import { NextRequest, NextResponse } from 'next/server'
import { reportsDb } from '@/lib/reports/database'
import { UpdateReportSettingsSchema } from '@/lib/reports/types'
import { createApiResponse, createApiError, getErrorMessage } from '@/lib/utils'
import { ensureDevServicesStarted } from '@/lib/server-startup'

export async function GET() {
  try {
    // 개발 환경에서 cron 서비스 자동 시작
    ensureDevServicesStarted()
    
    console.log('[API] Fetching daily report settings')
    
    const settings = await reportsDb.getReportSettings('daily')
    
    if (!settings) {
      return NextResponse.json(
        createApiError('Daily report settings not found'),
        { status: 404 }
      )
    }
    
    return NextResponse.json(
      createApiResponse({ settings })
    )
  } catch (error) {
    console.error('[API] Failed to fetch daily report settings:', error)
    
    return NextResponse.json(
      createApiError(getErrorMessage(error)),
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const updates = UpdateReportSettingsSchema.parse(body)
    
    console.log('[API] Updating daily report settings:', updates)
    
    const settings = await reportsDb.updateReportSettings('daily', updates)
    
    return NextResponse.json(
      createApiResponse({
        settings,
        message: '일간 리포트 설정이 업데이트되었습니다.'
      })
    )
  } catch (error) {
    console.error('[API] Failed to update daily report settings:', error)
    
    if (error instanceof Error && error.name === 'ZodError') {
      return NextResponse.json(
        createApiError(`입력 데이터가 올바르지 않습니다: ${error.message}`),
        { status: 400 }
      )
    }
    
    return NextResponse.json(
      createApiError(getErrorMessage(error)),
      { status: 500 }
    )
  }
}