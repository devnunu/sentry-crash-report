import { NextResponse } from 'next/server'
import { db } from '@/lib/database'
import { createApiResponse, createApiError } from '@/lib/utils'

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const testId = params.id

    // 현재 상태 조회
    const session = await db.getMonitorSession(testId)

    if (!session) {
      return NextResponse.json(
        createApiError('모니터를 찾을 수 없습니다'),
        { status: 404 }
      )
    }

    // 상태 토글
    const newStatus = session.status === 'paused' ? 'active' : 'paused'

    await db.updateMonitorSession(testId, {
      status: newStatus
    })

    const message = newStatus === 'paused'
      ? '테스트가 일시정지되었습니다'
      : '테스트가 재개되었습니다'

    return NextResponse.json(
      createApiResponse({
        status: newStatus,
        message
      })
    )
  } catch (error) {
    console.error('Failed to pause/resume test monitor:', error)
    return NextResponse.json(
      createApiError(error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다'),
      { status: 500 }
    )
  }
}

export const runtime = 'nodejs'
