import { NextRequest, NextResponse } from 'next/server'
import { reportsDb } from '@/lib/reports/database'
import { createApiResponse, createApiError } from '@/lib/utils'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const platform = (searchParams.get('platform') as 'android'|'ios') || 'android'
    const reports = await reportsDb.getReportExecutions('weekly', 1, 0, platform)
    if (reports.length === 0) {
      return NextResponse.json(createApiResponse({ platform, top: [], message: 'no report' }))
    }
    const exec = reports[0]
    const data: any = exec.result_data || {}
    const top = (data?.top5_events || []).slice(0,5).map((it: any) => ({
      issueId: it.issue_id || '',
      shortId: it.short_id || '',
      title: it.title || '제목 없음',
      events: it.events ?? 0,
      users: it.users ?? null,
      link: it.link || ''
    }))
    return NextResponse.json(createApiResponse({ platform, dateRange: { start: exec.start_date, end: exec.end_date }, top }))
  } catch (e:any) {
    return NextResponse.json(createApiError(e.message || 'failed'), { status: 500 })
  }
}

