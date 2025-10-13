import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/database'
import { monitoringService } from '@/lib/monitor'
import { createApiResponse, createApiError, getErrorMessage } from '@/lib/utils'
import { qstashService } from '@/lib/qstash-client'
import { startLocalMonitorRunner } from '@/lib/local-monitor-runner'

const StartTestMonitorSchema = z.object({
  platform: z.enum(['android', 'ios']),
  baseRelease: z.string().min(1, '릴리즈 버전을 입력하세요'),
  days: z.number().min(1).max(30).default(7),
  isTestMode: z.boolean().default(true),
  customInterval: z.number().min(1).max(60).default(5), // 분 단위
  matchedRelease: z.string().optional()
})

export async function POST(request: NextRequest) {
  try {
    // 요청 바디 파싱 및 검증
    const body = await request.json()
    const { platform, baseRelease, days, isTestMode, customInterval, matchedRelease } = StartTestMonitorSchema.parse(body)

    // 데이터베이스에 테스트 모니터링 세션 생성
    const monitorSession = await db.createMonitorSession(platform, baseRelease, days, isTestMode)

    // 세션에 커스텀 간격 저장 (업데이트된 세션을 받아와 이후 로직에서 활용)
    const existingMetadata = (monitorSession.metadata ?? {}) as Record<string, unknown>

    const updatedSession = await db.updateMonitorSession(monitorSession.id, {
      custom_interval_minutes: customInterval,
      metadata: {
        ...existingMetadata,
        isTestMode: true,
        customInterval,
        description: `테스트 모니터링 (${customInterval}분 간격)`
      },
      ...(matchedRelease ? { matched_release: matchedRelease } : {})
    })

    // Slack 시작 알림 (비동기, 실패해도 API 응답에는 영향 없음)
    monitoringService.notifyMonitorStart(updatedSession).catch(error => {
      console.error('Failed to send test monitor start notification:', error)
    })

    // QStash 스케줄 등록 (프로덕션에서만)
    let scheduleId: string | undefined
    let scheduleWarning: string | undefined
    if (process.env.NODE_ENV !== 'development') {
      try {
        const monitorJobId = qstashService.getJobId('test-monitor', monitorSession.id)
        const cronExpression = `*/${customInterval} * * * *` // 분 단위 간격

        const scheduleResult = await qstashService.scheduleJob({
          jobId: monitorJobId,
          endpoint: '/api/qstash/webhook',
          cron: cronExpression,
          body: {
            monitorId: monitorSession.id,
            isTestMode: true,
            customInterval: customInterval
          }
        })

        console.log(`Test monitor tick scheduled: ${scheduleResult.scheduleId} (${customInterval}분 간격)`)

        await db.updateMonitorSession(monitorSession.id, {
          qstash_schedule_id: scheduleResult.scheduleId
        })
        scheduleId = scheduleResult.scheduleId
      } catch (error) {
        console.error('Failed to schedule test monitor tick:', error)
        scheduleWarning = 'QStash 스케줄 등록에 실패했습니다. 필요 시 수동으로 Tick을 실행해 주세요.'
        // QStash 스케줄링 실패해도 모니터링은 계속 진행
      }
    } else {
      scheduleWarning = '개발 환경에서는 로컬 러너가 주기 실행을 담당합니다.'
    }

    // 즉시 1회 Tick 실행하여 결과를 바로 확인할 수 있도록 함
    let immediateResult: Awaited<ReturnType<typeof monitoringService.executeSpecificMonitor>> | null = null
    try {
      immediateResult = await monitoringService.executeSpecificMonitor(monitorSession.id, customInterval)
    } catch (error) {
      console.error('Failed to run immediate test monitor tick:', error)
    }

    // 로컬 개발 환경에서는 QStash 대신 내부 타이머로 반복 실행
    startLocalMonitorRunner(monitorSession.id, customInterval)

    return NextResponse.json(
      createApiResponse({
        monitorId: monitorSession.id,
        message: `${platform} 플랫폼의 ${baseRelease} 버전 테스트 모니터링이 시작되었습니다. (${customInterval}분 간격)`,
        session: updatedSession,
        interval: `${customInterval}분`,
        cronExpression: `*/${customInterval} * * * *`,
        scheduleId,
        scheduleWarning,
        immediateResult
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

export const runtime = 'nodejs'
