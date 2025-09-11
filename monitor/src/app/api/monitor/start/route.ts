import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/database'
import { monitoringService } from '@/lib/monitor'
import { StartMonitorSchema } from '@/lib/types'
import { createApiResponse, createApiError, getErrorMessage } from '@/lib/utils'
import { qstashService } from '@/lib/qstash-client'

export async function POST(request: NextRequest) {
  try {
    // 요청 바디 파싱 및 검증
    const body = await request.json()
    const { platform, baseRelease, days, isTestMode } = StartMonitorSchema.parse(body)
    
    // 데이터베이스에 모니터링 세션 생성
    const monitorSession = await db.createMonitorSession(platform, baseRelease, days, isTestMode)
    
    // Slack 시작 알림 (비동기, 실패해도 API 응답에는 영향 없음)
    monitoringService.notifyMonitorStart(monitorSession).catch(error => {
      console.error('Failed to send start notification:', error)
    })

    // QStash에 monitor tick 스케줄 등록 (30분마다)
    try {
      const monitorJobId = qstashService.getJobId('monitor', monitorSession.id)
      const scheduleResult = await qstashService.scheduleJob({
        jobId: monitorJobId,
        endpoint: '/api/qstash/webhook',
        cron: '*/30 * * * *', // 30분마다
        body: { monitorId: monitorSession.id }
      })
      
      console.log(`Monitor tick scheduled: ${scheduleResult.scheduleId}`)
      
      // 스케줄 ID를 모니터 세션에 저장
      await db.updateMonitorSession(monitorSession.id, {
        qstash_schedule_id: scheduleResult.scheduleId
      })
    } catch (error) {
      console.error('Failed to schedule monitor tick:', error)
      // QStash 스케줄링 실패해도 모니터링은 계속 진행
    }
    
    return NextResponse.json(
      createApiResponse({
        monitorId: monitorSession.id,
        message: `${platform} 플랫폼의 ${baseRelease} 버전 모니터링이 시작되었습니다.`,
        session: monitorSession
      }),
      { status: 201 }
    )
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        createApiError(`입력 데이터가 올바르지 않습니다: ${error.issues.map(e => e.message).join(', ')}`),
        { status: 400 }
      )
    }
    
    return NextResponse.json(
      createApiError(getErrorMessage(error)),
      { status: 500 }
    )
  }
}