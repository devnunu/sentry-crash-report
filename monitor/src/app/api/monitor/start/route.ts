import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/database'
import { monitoringService } from '@/lib/monitor'
import { StartMonitorSchema } from '@/lib/types'
import { createApiResponse, createApiError, getErrorMessage } from '@/lib/utils'

export async function POST(request: NextRequest) {
  try {
    // 요청 바디 파싱 및 검증
    const body = await request.json()
    const { platform, baseRelease, days } = StartMonitorSchema.parse(body)
    
    // 데이터베이스에 모니터링 세션 생성
    const monitorSession = await db.createMonitorSession(platform, baseRelease, days)
    
    // Slack 시작 알림 (비동기, 실패해도 API 응답에는 영향 없음)
    monitoringService.notifyMonitorStart(monitorSession).catch(error => {
      console.error('Failed to send start notification:', error)
    })
    
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