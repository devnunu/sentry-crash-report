import { NextRequest, NextResponse } from 'next/server'
import { reportsDb } from '@/lib/reports/database'
import { UpdateReportSettingsSchema } from '@/lib/reports/types'
import { createApiResponse, createApiError, getErrorMessage } from '@/lib/utils'

export async function GET() {
  try {
    console.log('[API] Fetching weekly report settings')
    
    const settings = await reportsDb.getReportSettings('weekly')
    
    if (!settings) {
      return NextResponse.json(
        createApiError('Weekly report settings not found'),
        { status: 404 }
      )
    }
    
    return NextResponse.json(
      createApiResponse({ settings })
    )
  } catch (error) {
    console.error('[API] Failed to fetch weekly report settings:', error)
    
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
    
    console.log('[API] Updating weekly report settings:', updates)
    
    const settings = await reportsDb.updateReportSettings('weekly', updates)
    
    return NextResponse.json(
      createApiResponse({
        settings,
        message: '주간 리포트 설정이 업데이트되었습니다.'
      })
    )
  } catch (error) {
    console.error('[API] Failed to update weekly report settings:', error)
    
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