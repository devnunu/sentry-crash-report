import { NextRequest, NextResponse } from 'next/server'
import type { Platform } from '@/lib/types'
import { SentryDataService } from '@/lib/reports/sentry-data'
import { parseDate } from '@/lib/reports/utils'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const platform = searchParams.get('platform') as Platform
    const targetDate = searchParams.get('targetDate')

    if (!platform || !['android', 'ios'].includes(platform)) {
      return NextResponse.json({ success: false, error: 'Invalid platform parameter' }, { status: 400 })
    }
    if (!targetDate) {
      return NextResponse.json({ success: false, error: 'targetDate parameter is required' }, { status: 400 })
    }

    const service = new SentryDataService(platform)
    const date = parseDate(targetDate)

    const [metrics, issues] = await Promise.all([
      service.getDayMetrics(date),
      service.getIssuesForDay(date, 200),
    ])

    return NextResponse.json({
      success: true,
      data: {
        date: metrics.date_kst,
        totals: {
          events: metrics.crash_events,
          issues: metrics.unique_issues,
          users: metrics.impacted_users,
        },
        issues,
      },
    })
  } catch (error) {
    console.error('daily/issues error:', error)
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 })
  }
}

