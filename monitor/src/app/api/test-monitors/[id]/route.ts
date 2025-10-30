import { NextResponse } from 'next/server'
import { db } from '@/lib/database'
import { createApiResponse, createApiError } from '@/lib/utils'
import { qstashService } from '@/lib/qstash-client'

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const testId = params.id

    // 모니터 세션 조회
    const session = await db.getMonitorSession(testId)

    if (!session) {
      return NextResponse.json(
        createApiError('모니터를 찾을 수 없습니다'),
        { status: 404 }
      )
    }

    // QStash 스케줄 삭제 (존재하는 경우)
    if (session.qstash_schedule_id) {
      try {
        await qstashService.deleteSchedule(session.qstash_schedule_id)
        console.log(`QStash 스케줄 삭제: ${session.qstash_schedule_id}`)
      } catch (error) {
        console.error('QStash 스케줄 삭제 실패:', error)
        // 스케줄 삭제 실패해도 계속 진행
      }
    }

    // 모니터 세션 상태 업데이트
    await db.updateMonitorSession(testId, {
      status: 'stopped'
    })

    return NextResponse.json(
      createApiResponse({
        message: '테스트 모니터링이 중지되었습니다',
        monitorId: testId
      })
    )
  } catch (error) {
    console.error('Failed to stop test monitor:', error)
    return NextResponse.json(
      createApiError(error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다'),
      { status: 500 }
    )
  }
}

export const runtime = 'nodejs'
