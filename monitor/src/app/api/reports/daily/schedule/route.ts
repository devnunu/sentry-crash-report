import { NextRequest, NextResponse } from 'next/server'
import { dailyReportService } from '@/lib/reports/daily-report'
import { reportsDb } from '@/lib/reports/database'
import { createApiResponse, createApiError, getErrorMessage } from '@/lib/utils'
import { devCronService } from '@/lib/dev-cron'

export async function POST(request: NextRequest) {
  try {
    // 개발 환경에서 cron 서비스 자동 시작
    if (process.env.NODE_ENV === 'development') {
      devCronService.start()
    }
    
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

    // 현재 시간과 설정 확인 (KST 기준)
    const now = new Date()
    // KST로 변환: toLocaleString 사용 (더 정확함)
    const kstTimeStr = now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' })
    const kstTime = new Date(kstTimeStr)
    const dayOfWeek = kstTime.getDay()
    const currentTime = `${kstTime.getHours().toString().padStart(2, '0')}:${kstTime.getMinutes().toString().padStart(2, '0')}`
    
    console.log(`⏰ Current time check - UTC: ${now.toISOString()}, KST String: ${kstTimeStr}, Time: ${currentTime}`)
    
    // 요일 매핑: 0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토
    const dayMapping = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
    const todayKey = dayMapping[dayOfWeek]
    
    // 설정된 요일 확인 (기본값: 월화수목금)
    const scheduleDays = settings.schedule_days || ['mon', 'tue', 'wed', 'thu', 'fri']
    const shouldRunToday = scheduleDays.includes(todayKey as any)
    
    console.log(`📅 Day check - Today: ${todayKey}, Scheduled days: [${scheduleDays.join(', ')}], Should run: ${shouldRunToday}`)
    
    if (!shouldRunToday) {
      return NextResponse.json(
        createApiResponse({
          message: `오늘(${todayKey})은 일간 리포트 실행일이 아닙니다.`,
          skipped: true,
          todayKey,
          scheduleDays
        })
      )
    }

    // 설정된 시간 확인 (기본값: 09:00)
    let scheduleTime = settings.schedule_time || '09:00'
    // DB에서 초까지 포함된 시간 형식(HH:MM:SS)을 HH:MM로 변환
    if (scheduleTime.length === 8) {
      scheduleTime = scheduleTime.substring(0, 5)
    }
    console.log(`⏰ Time check - Current: ${currentTime}, Scheduled: ${scheduleTime}, Match: ${currentTime === scheduleTime}`)
    
    if (currentTime !== scheduleTime) {
      return NextResponse.json(
        createApiResponse({
          message: `현재 시간(${currentTime})이 예약된 시간(${scheduleTime})과 다릅니다.`,
          skipped: true,
          currentTime,
          scheduleTime
        })
      )
    }

    // 중복 실행 방지: 최근 1시간 내 실행된 리포트가 있는지 확인
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
    const recentReports = await reportsDb.getReportExecutions('daily', { limit: 5 })
    const recentScheduledReport = recentReports.find(report => 
      report.trigger_type === 'scheduled' && 
      new Date(report.created_at) > oneHourAgo
    )

    if (recentScheduledReport) {
      return NextResponse.json(
        createApiResponse({
          message: `최근 1시간 내에 이미 실행된 스케줄 리포트가 있습니다.`,
          skipped: true,
          lastExecution: recentScheduledReport.created_at
        })
      )
    }

    console.log(`🕒 Executing daily report at scheduled time: ${currentTime} on ${todayKey}`)

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