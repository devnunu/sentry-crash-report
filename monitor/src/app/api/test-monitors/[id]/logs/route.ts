import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/database'
import { createApiResponse, createApiError } from '@/lib/utils'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const testId = params.id
    const searchParams = request.nextUrl.searchParams
    const type = searchParams.get('type') || 'all'

    // 히스토리 조회
    const histories = await db.getMonitorHistory(testId, 100)

    // 히스토리를 로그 형식으로 변환
    const logs = histories.flatMap(history => {
      const logs: any[] = []

      // 실행 로그
      logs.push({
        id: `${history.id}-run`,
        testId,
        type: 'run',
        timestamp: history.executed_at,
        title: '모니터링 실행',
        message: `크래시 ${history.events_count}건, 이슈 ${history.issues_count}개, 사용자 ${history.users_count}명`,
        data: {
          events: history.events_count,
          issues: history.issues_count,
          users: history.users_count
        }
      })

      // 알림 로그
      if (history.slack_sent) {
        logs.push({
          id: `${history.id}-notification`,
          testId,
          type: 'notification',
          timestamp: history.executed_at,
          title: 'Slack 알림 전송',
          message: 'Slack 알림이 성공적으로 전송되었습니다.'
        })
      } else {
        logs.push({
          id: `${history.id}-error`,
          testId,
          type: 'error',
          timestamp: history.executed_at,
          title: 'Slack 알림 실패',
          message: 'Slack 알림 전송에 실패했습니다.',
          error: 'Slack webhook 전송 실패'
        })
      }

      return logs
    })

    // 타입 필터링
    const filteredLogs = type === 'all'
      ? logs
      : logs.filter(log => log.type === type)

    return NextResponse.json(createApiResponse(filteredLogs))
  } catch (error) {
    console.error('Failed to fetch test monitor logs:', error)
    return NextResponse.json(
      createApiError(error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다'),
      { status: 500 }
    )
  }
}

export const runtime = 'nodejs'
