import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/database'
import { monitoringService } from '@/lib/monitor'
import { StopMonitorSchema } from '@/lib/types'
import { createApiResponse, createApiError, getErrorMessage } from '@/lib/utils'
import { qstashService } from '@/lib/qstash-client'

export async function POST(request: NextRequest) {
  try {
    // 요청 바디 파싱 및 검증
    const body = await request.json()
    const { monitorId } = StopMonitorSchema.parse(body)
    
    // 모니터 존재 확인
    const existingMonitor = await db.getMonitorSession(monitorId)
    
    if (!existingMonitor) {
      return NextResponse.json(
        createApiError('모니터를 찾을 수 없습니다.'),
        { status: 404 }
      )
    }
    
    if (existingMonitor.status !== 'active') {
      return NextResponse.json(
        createApiError(`이미 ${existingMonitor.status === 'stopped' ? '중단된' : '만료된'} 모니터입니다.`),
        { status: 400 }
      )
    }
    
    // QStash 스케줄 삭제
    if (existingMonitor.qstash_schedule_id) {
      try {
        await qstashService.deleteSchedule(existingMonitor.qstash_schedule_id)
        console.log(`Monitor tick schedule deleted: ${existingMonitor.qstash_schedule_id}`)
      } catch (error) {
        console.error('Failed to delete monitor tick schedule:', error)
      }
    }

    // 모니터 중단
    const stoppedMonitor = await db.stopMonitorSession(monitorId)
    
    // Slack 중단 알림 (비동기, 실패해도 API 응답에는 영향 없음)
    monitoringService.notifyMonitorStop(stoppedMonitor, 'manual').catch(error => {
      console.error('Failed to send stop notification:', error)
    })
    
    return NextResponse.json(
      createApiResponse({
        monitorId: stoppedMonitor.id,
        message: `${stoppedMonitor.platform} 플랫폼의 ${stoppedMonitor.base_release} 버전 모니터링이 중단되었습니다.`,
        monitor: stoppedMonitor
      })
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