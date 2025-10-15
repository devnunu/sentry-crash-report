import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/database'
import { monitoringService } from '@/lib/monitor'
import { createApiResponse, createApiError, getErrorMessage } from '@/lib/utils'

export async function POST(request: NextRequest) {
  try {
    // API 키 인증 (QStash webhook에서 호출될 때를 위한 보안)
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

    // 요청 바디에서 테스트 모드 파라미터 추출
    let monitorId: string | undefined
    let isTestMode: boolean | undefined
    let customInterval: number | undefined

    try {
      const body = await request.text()
      if (body) {
        const parsed = JSON.parse(body)
        monitorId = parsed.monitorId
        isTestMode = parsed.isTestMode
        customInterval = parsed.customInterval
      }
    } catch (error) {
      // 바디가 없거나 JSON이 아닌 경우 무시 (기존 호환성 유지)
    }

    console.log('🕒 Tick 실행 시작:', new Date().toISOString(),
      isTestMode ? `(테스트 모드, ${customInterval}분 간격, 모니터ID: ${monitorId})` : '')

    // 만료된 모니터 정리
    const expiredCount = await db.cleanupExpiredMonitors()
    if (expiredCount > 0) {
      console.log(`🗑️ ${expiredCount}개의 만료된 모니터를 정리했습니다.`)
    }

    // 테스트 모드인 경우 특정 모니터만 실행, 아니면 모든 활성 모니터 실행
    const executionResult = isTestMode && monitorId
      ? await monitoringService.executeSpecificMonitor(monitorId, customInterval)
      : await monitoringService.executeAllActiveMonitors()
    
    const message = `📈 Tick 완료: ${executionResult.processedCount}개 처리, ${executionResult.skippedCount}개 스킵, ${executionResult.errorCount}개 실패, ${expiredCount}개 만료`
    console.log(message)
    
    return NextResponse.json(
      createApiResponse({
        message,
        processedCount: executionResult.processedCount,
        skippedCount: executionResult.skippedCount,
        errorCount: executionResult.errorCount,
        expiredCount,
        results: executionResult.results,
        timestamp: new Date().toISOString()
      })
    )
    
  } catch (error) {
    console.error('❌ Tick 실행 오류:', error)
    return NextResponse.json(
      createApiError(getErrorMessage(error)),
      { status: 500 }
    )
  }
}