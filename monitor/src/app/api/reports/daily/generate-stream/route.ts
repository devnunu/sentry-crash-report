import { NextRequest } from 'next/server'
import { DailyReportService } from '@/lib/reports/daily-report'
import { GenerateDailyReportSchema } from '@/lib/reports/types'
import { parseDate } from '@/lib/reports/utils'

// SSE 스트림을 위한 커스텀 TransformStream
class LogStream extends TransformStream {
  constructor() {
    super({
      transform(chunk, controller) {
        const data = `data: ${JSON.stringify(chunk)}\n\n`
        controller.enqueue(new TextEncoder().encode(data))
      }
    })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { targetDate, sendSlack, includeAI, isTestMode, platform } = GenerateDailyReportSchema.parse(body)

    // SSE 스트림 설정
    const stream = new LogStream()
    const writer = stream.writable.getWriter()

    // 즉시 응답 반환 (스트리밍 시작)
    const response = new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
      }
    })

    // 백그라운드에서 리포트 생성 (await 하지 않음)
    generateReportWithLogs(writer, {
      targetDate,
      sendSlack,
      includeAI,
      isTestMode,
      platform,
      triggerType: 'manual'
    })

    return response

  } catch (error) {
    console.error('[API] Stream setup failed:', error)
    return new Response(
      `data: ${JSON.stringify({ type: 'error', message: '스트림 설정에 실패했습니다' })}\n\n`,
      {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache'
        }
      }
    )
  }
}

async function generateReportWithLogs(
  writer: WritableStreamDefaultWriter,
  options: {
    targetDate?: string
    sendSlack?: boolean
    includeAI?: boolean
    isTestMode?: boolean
    platform?: string
    triggerType: 'manual'
  }
) {
  try {
    const { targetDate, sendSlack, includeAI, isTestMode, platform, triggerType } = options

    // 시작 로그
    await writer.write({
      type: 'log',
      message: `🚀 일간 리포트 생성을 시작합니다...`,
      timestamp: new Date().toISOString()
    })

    // 날짜 파싱
    let parsedTargetDate: Date | undefined
    if (targetDate) {
      try {
        parsedTargetDate = parseDate(targetDate)
        await writer.write({
          type: 'log',
          message: `📅 대상 날짜: ${targetDate}`,
          timestamp: new Date().toISOString()
        })
      } catch (err) {
        await writer.write({
          type: 'error',
          message: '❌ 잘못된 날짜 형식입니다. YYYY-MM-DD 형식을 사용하세요.',
          timestamp: new Date().toISOString()
        })
        await writer.close()
        return
      }
    } else {
      await writer.write({
        type: 'log',
        message: `📅 대상 날짜: 어제 (기본값)`,
        timestamp: new Date().toISOString()
      })
    }

    // 플랫폼 설정
    const platforms: Array<'android' | 'ios'> = platform === 'all' ? ['android', 'ios'] : [platform as 'android' | 'ios']
    await writer.write({
      type: 'log',
      message: `🎯 대상 플랫폼: ${platforms.join(', ')}`,
      timestamp: new Date().toISOString()
    })

    const modeText = isTestMode ? '[테스트 모드] ' : ''
    if (isTestMode) {
      await writer.write({
        type: 'log',
        message: `🧪 테스트 모드로 실행됩니다`,
        timestamp: new Date().toISOString()
      })
    }

    // 각 플랫폼별로 리포트 생성
    const results = []
    for (let i = 0; i < platforms.length; i++) {
      const p = platforms[i]
      const platformEmoji = p === 'android' ? '🤖' : '🍎'

      await writer.write({
        type: 'log',
        message: `${platformEmoji} ${p.toUpperCase()} 리포트 생성 중... (${i + 1}/${platforms.length})`,
        timestamp: new Date().toISOString()
      })

      try {
        const svc = new DailyReportService(p)
        const result = await svc.generateReport({
          targetDate: parsedTargetDate,
          sendSlack,
          includeAI,
          triggerType,
          isTestMode: isTestMode || false
        })

        results.push({ platform: p, executionId: result.executionId })

        await writer.write({
          type: 'log',
          message: `✅ ${platformEmoji} ${p.toUpperCase()} 리포트 생성 완료 (ID: ${result.executionId})`,
          timestamp: new Date().toISOString()
        })

        if (sendSlack) {
          await writer.write({
            type: 'log',
            message: `💬 ${modeText}Slack 알림이 전송되었습니다`,
            timestamp: new Date().toISOString()
          })
        }

      } catch (platformError) {
        await writer.write({
          type: 'error',
          message: `❌ ${platformEmoji} ${p.toUpperCase()} 리포트 생성 실패: ${platformError instanceof Error ? platformError.message : String(platformError)}`,
          timestamp: new Date().toISOString()
        })
      }
    }

    // 완료 메시지
    await writer.write({
      type: 'success',
      message: `🎉 모든 리포트 생성이 완료되었습니다!`,
      data: {
        executionIds: results,
        platformCount: platforms.length,
        successCount: results.length
      },
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    await writer.write({
      type: 'error',
      message: `❌ 리포트 생성 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`,
      timestamp: new Date().toISOString()
    })
  } finally {
    await writer.close()
  }
}

export const runtime = 'nodejs'