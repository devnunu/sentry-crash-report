import { NextRequest, NextResponse } from 'next/server'
import { WeeklyReportService } from '@/lib/reports/weekly-report'
import { GenerateWeeklyReportSchema } from '@/lib/reports/types'
import { parseDate } from '@/lib/reports/utils'
import { createApiResponse, createApiError, getErrorMessage } from '@/lib/utils'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { targetWeek, startDate, endDate, sendSlack, includeAI, isTestMode, platform } = GenerateWeeklyReportSchema.parse(body)
    
    // 날짜 파싱
    let parsedTargetWeek: Date | undefined
    let parsedStartDate: Date | undefined
    let parsedEndDate: Date | undefined
    
    if (targetWeek) {
      try {
        parsedTargetWeek = parseDate(targetWeek)
      } catch (error) {
        return NextResponse.json(
          createApiError('Invalid target week format. Use YYYY-MM-DD (Monday)'),
          { status: 400 }
        )
      }
    }
    
    if (startDate && endDate) {
      try {
        parsedStartDate = parseDate(startDate)
        parsedEndDate = parseDate(endDate)
        
        if (parsedStartDate >= parsedEndDate) {
          return NextResponse.json(
            createApiError('Start date must be before end date'),
            { status: 400 }
          )
        }
      } catch (error) {
        return NextResponse.json(
          createApiError('Invalid date format. Use YYYY-MM-DD'),
          { status: 400 }
        )
      }
    }
    
    const modeText = isTestMode ? '[테스트 모드] ' : ''
    console.log(`[API] ${modeText}Generating weekly report for ${targetWeek || startDate + ' to ' + endDate || 'last week'} - platform=${platform}`)
    
    // 리포트 생성
    const platforms: Array<'android' | 'ios'> = platform === 'all' ? ['android', 'ios'] : [platform as 'android' | 'ios']
    const results = [] as Array<{ platform: string; executionId: string }>
    for (const p of platforms) {
      const svc = new WeeklyReportService(p)
      const result = await svc.generateReport({
        targetWeek: parsedTargetWeek,
        startDate: parsedStartDate,
        endDate: parsedEndDate,
        sendSlack,
        includeAI,
        triggerType: 'manual',
        isTestMode: isTestMode || false
      })
      results.push({ platform: p, executionId: result.executionId })
    }
    
    return NextResponse.json(
      createApiResponse({
        executionIds: results,
        message: `주간 리포트가 성공적으로 생성되었습니다. (${platforms.join(', ')})`
      }),
      { status: 201 }
    )
  } catch (error) {
    console.error('[API] Weekly report generation failed:', error)
    
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
