import { NextRequest, NextResponse } from 'next/server'
import { dailyReportService } from '@/lib/reports/daily-report'
import { GenerateDailyReportSchema } from '@/lib/reports/types'
import { parseDate } from '@/lib/reports/utils'
import { createApiResponse, createApiError, getErrorMessage } from '@/lib/utils'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { targetDate, sendSlack, includeAI } = GenerateDailyReportSchema.parse(body)
    
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
    
    console.log(`[API] Generating daily report for ${targetDate || 'yesterday'}`)
    
    // 리포트 생성
    const result = await dailyReportService.generateReport({
      targetDate: parsedTargetDate,
      sendSlack,
      includeAI,
      triggerType: 'manual'
    })
    
    return NextResponse.json(
      createApiResponse({
        executionId: result.executionId,
        message: '일간 리포트가 성공적으로 생성되었습니다.',
        data: result.data,
        aiAnalysis: result.aiAnalysis
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