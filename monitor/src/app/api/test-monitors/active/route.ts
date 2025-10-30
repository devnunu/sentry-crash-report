import { NextResponse } from 'next/server'
import { db } from '@/lib/database'
import { createApiResponse, createApiError } from '@/lib/utils'

export async function GET() {
  try {
    // 활성 상태의 테스트 모니터만 조회
    const sessions = await db.getActiveMonitorSessions()

    // 테스트 모드인 것만 필터링
    const testSessions = sessions.filter(s => s.is_test_mode && s.custom_interval_minutes)

    // 각 세션의 히스토리 정보를 별도로 조회
    const testMonitors = await Promise.all(
      testSessions.map(async (session) => {
        // 히스토리 조회
        const histories = await db.getMonitorHistory(session.id, 100)

        // 통계 계산
        const runCount = histories.length
        const notificationsSent = histories.filter(h => h.slack_sent).length
        const notificationsFailed = histories.filter(h => !h.slack_sent).length
        const lastExecution = histories.length > 0
          ? histories.reduce((latest, h) =>
              new Date(h.executed_at) > new Date(latest.executed_at) ? h : latest
            ).executed_at
          : null

        // 예상 실행 횟수 계산
        const startedAt = new Date(session.started_at)
        const expiresAt = new Date(session.expires_at)
        const durationMs = expiresAt.getTime() - startedAt.getTime()
        const intervalMs = (session.custom_interval_minutes || 60) * 60 * 1000
        const expectedRuns = Math.ceil(durationMs / intervalMs)

        // 다음 실행 시간 계산
        const lastExecutionTime = lastExecution
          ? new Date(lastExecution)
          : new Date(session.started_at)
        const nextRunAt = new Date(lastExecutionTime.getTime() + intervalMs)

        return {
          id: session.id,
          platform: session.platform,
          version: session.matched_release || session.base_release,
          intervalMinutes: session.custom_interval_minutes || 5,
          durationDays: Math.ceil(durationMs / (24 * 60 * 60 * 1000)),
          startedAt: session.started_at,
          nextRunAt: nextRunAt.toISOString(),
          runCount,
          expectedRuns,
          notificationsSent,
          notificationsFailed,
          lastNotificationAt: lastExecution,
          isPaused: session.status === 'paused'
        }
      })
    )

    return NextResponse.json(createApiResponse(testMonitors))
  } catch (error) {
    console.error('Failed to fetch active test monitors:', error)
    return NextResponse.json(
      createApiError(error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다'),
      { status: 500 }
    )
  }
}

export const runtime = 'nodejs'
