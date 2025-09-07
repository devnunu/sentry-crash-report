import { NextRequest, NextResponse } from 'next/server'
import { dailyReportService } from '@/lib/reports/daily-report'
import { reportsDb } from '@/lib/reports/database'
import { createApiResponse, createApiError, getErrorMessage } from '@/lib/utils'

export async function POST(request: NextRequest) {
  try {
    // CRON 인증 (선택사항)
    const cronSecret = process.env.CRON_SECRET
    if (cronSecret) {
      const authHeader = request.headers.get('authorization')
      if (authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json(
          createApiError('인증되지 않은 요청입니다.'),
          { status: 401 }
        )
      }
    }

    console.log('🕒 Daily Report Scheduled Execution:', new Date().toISOString())
    
    // 설정 확인
    const settings = await reportsDb.getReportSettings('daily')
    if (!settings || !settings.auto_enabled) {
      console.log('📴 Daily report auto execution is disabled')
      return NextResponse.json(
        createApiResponse({
          message: '일간 리포트 자동 실행이 비활성화되어 있습니다.',
          skipped: true
        })
      )
    }

    // 오늘이 화수목금인지 확인 (1=월, 2=화, 3=수, 4=목, 5=금, 6=토, 0=일)
    const today = new Date()
    const dayOfWeek = today.getDay()
    const isWeekday = dayOfWeek >= 2 && dayOfWeek <= 5 // 화수목금
    
    if (!isWeekday) {
      console.log(`📅 Today is not a weekday (${dayOfWeek}), skipping daily report`)
      return NextResponse.json(
        createApiResponse({
          message: '주말에는 일간 리포트를 생성하지 않습니다.',
          skipped: true,
          dayOfWeek
        })
      )
    }

    // 리포트 생성
    const result = await dailyReportService.generateReport({
      sendSlack: true,
      includeAI: settings.ai_enabled,
      triggerType: 'scheduled'
    })

    console.log(`✅ Daily report scheduled execution completed: ${result.executionId}`)

    return NextResponse.json(
      createApiResponse({
        message: '일간 리포트가 예약 실행되었습니다.',
        executionId: result.executionId,
        timestamp: new Date().toISOString()
      })
    )
  } catch (error) {
    console.error('❌ Daily report scheduled execution failed:', error)
    
    return NextResponse.json(
      createApiError(getErrorMessage(error)),
      { status: 500 }
    )
  }
}