import { NextResponse } from 'next/server'
import { db } from '@/lib/database'
import { createApiResponse, createApiError, getErrorMessage } from '@/lib/utils'

export async function GET() {
  try {
    // 먼저 만료된 모니터들을 정리
    await db.cleanupExpiredMonitors()
    
    // 모든 모니터링 세션 조회 (활성, 중단, 만료 모두 포함)
    const monitors = await db.getMonitorSessions()
    
    // 각 모니터의 최근 히스토리 정보도 함께 조회
    const monitorsWithHistory = await Promise.all(
      monitors.map(async (monitor) => {
        const lastHistory = await db.getLastMonitorHistory(monitor.id)
        return {
          ...monitor,
          lastHistory
        }
      })
    )
    
    return NextResponse.json(
      createApiResponse({
        monitors: monitorsWithHistory,
        total: monitors.length,
        active: monitors.filter(m => m.status === 'active').length,
        stopped: monitors.filter(m => m.status === 'stopped').length,
        expired: monitors.filter(m => m.status === 'expired').length
      })
    )
    
  } catch (error) {
    return NextResponse.json(
      createApiError(getErrorMessage(error)),
      { status: 500 }
    )
  }
}

// 특정 모니터 상세 조회
export async function POST(request: Request) {
  try {
    const { monitorId } = await request.json()
    
    if (!monitorId) {
      return NextResponse.json(
        createApiError('모니터 ID가 필요합니다.'),
        { status: 400 }
      )
    }
    
    const monitor = await db.getMonitorSession(monitorId)
    
    if (!monitor) {
      return NextResponse.json(
        createApiError('모니터를 찾을 수 없습니다.'),
        { status: 404 }
      )
    }
    
    // 해당 모니터의 히스토리 조회
    const history = await db.getMonitorHistory(monitorId, 100)
    
    return NextResponse.json(
      createApiResponse({
        monitor,
        history
      })
    )
    
  } catch (error) {
    return NextResponse.json(
      createApiError(getErrorMessage(error)),
      { status: 500 }
    )
  }
}