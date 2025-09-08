import { NextRequest, NextResponse } from 'next/server'
import { weeklyReportService } from '@/lib/reports/weekly-report'
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

    console.log('🕒 Weekly Report Scheduled Execution:', new Date().toISOString())
    
    // 설정 확인
    const settings = await reportsDb.getReportSettings('weekly')
    if (!settings || !settings.auto_enabled) {
      console.log('📴 Weekly report auto execution is disabled')
      return NextResponse.json(
        createApiResponse({
          message: '주간 리포트 자동 실행이 비활성화되어 있습니다.',
          skipped: true
        })
      )
    }

    // 오늘이 설정된 요일인지 확인
    const today = new Date()
    const dayOfWeek = today.getDay()
    
    // 요일 매핑: 0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토
    const dayMapping = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
    const todayKey = dayMapping[dayOfWeek]
    
    // 설정된 요일 확인 (기본값: 월요일만)
    const scheduleDays = settings.schedule_days || ['mon']
    const shouldRunToday = scheduleDays.includes(todayKey as any)
    
    if (!shouldRunToday) {
      console.log(`📅 Today (${todayKey}) is not in scheduled days [${scheduleDays.join(', ')}], skipping weekly report`)
      return NextResponse.json(
        createApiResponse({
          message: `오늘(${todayKey})은 주간 리포트 실행일이 아닙니다.`,
          skipped: true,
          todayKey,
          scheduleDays
        })
      )
    }

    // 리포트 생성 (지난주 데이터)
    const result = await weeklyReportService.generateReport({
      sendSlack: true,
      includeAI: settings.ai_enabled,
      triggerType: 'scheduled'
    })

    console.log(`✅ Weekly report scheduled execution completed: ${result.executionId}`)

    return NextResponse.json(
      createApiResponse({
        message: '주간 리포트가 예약 실행되었습니다.',
        executionId: result.executionId,
        timestamp: new Date().toISOString()
      })
    )
  } catch (error) {
    console.error('❌ Weekly report scheduled execution failed:', error)
    
    return NextResponse.json(
      createApiError(getErrorMessage(error)),
      { status: 500 }
    )
  }
}