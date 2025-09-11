import { NextRequest, NextResponse } from 'next/server'
import { DailyReportService } from '@/lib/reports/daily-report'
import { GenerateDailyReportSchema } from '@/lib/reports/types'
import { parseDate } from '@/lib/reports/utils'
import { createApiResponse, createApiError, getErrorMessage } from '@/lib/utils'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { targetDate, sendSlack, includeAI, isTestMode, platform } = GenerateDailyReportSchema.parse(body)
    
    // 날짜 파싱
    let parsedTargetDate: Date | undefined
    if (targetDate) {
      try {
        parsedTargetDate = parseDate(targetDate)
      } catch (error) {
        return NextResponse.json(
          createApiError('Invalid target date format. Use YYYY-MM-DD'),
          { status: 400 }
        )
      }
    }
    
    const triggerHeader = request.headers.get('x-trigger-type')
    const triggerType: 'scheduled' | 'manual' = triggerHeader === 'scheduled' ? 'scheduled' : 'manual'
    const modeText = isTestMode ? '[테스트 모드] ' : ''
    console.log(`[API] ${modeText}Generating daily report for ${targetDate || 'yesterday'} - platform=${platform} - trigger=${triggerType}`)
    
    // 리포트 생성
    const platforms: Array<'android' | 'ios'> = platform === 'all' ? ['android', 'ios'] : [platform as 'android' | 'ios']
    const results = [] as Array<{ platform: string; executionId: string }>
    for (const p of platforms) {
      const svc = new DailyReportService(p)
      const result = await svc.generateReport({
        targetDate: parsedTargetDate,
        sendSlack,
        includeAI,
        triggerType,
        isTestMode: isTestMode || false
      })
      results.push({ platform: p, executionId: result.executionId })
    }
    
    return NextResponse.json(
      createApiResponse({
        executionIds: results,
        message: `일간 리포트가 성공적으로 생성되었습니다. (${platforms.join(', ')})`
      }),
      { status: 201 }
    )
  } catch (error) {
    console.error('[API] Daily report generation failed:', error)
    
    if (error instanceof Error && error.name === 'ZodError') {
      return NextResponse.json(
        createApiError(`입력 데이터가 올바르지 않습니다: ${error.message}`),
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
