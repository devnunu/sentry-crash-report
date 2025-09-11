import { NextRequest, NextResponse } from 'next/server'
import { reportsDb } from '@/lib/reports/database'
import { createApiResponse, createApiError } from '@/lib/utils'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const platform = (searchParams.get('platform') as 'android'|'ios') || 'android'
    const reports = await reportsDb.getReportExecutions('daily', 1, 0, platform)
    if (reports.length === 0) {
      return NextResponse.json(createApiResponse({ platform, top: [], message: 'no report' }))
    }
    const exec = reports[0]
    const data: any = exec.result_data || {}
    const dateKey = exec.target_date
    const dayObj = data[dateKey] || data['today'] || null
    const topArr = dayObj?.top_5_issues || []
    const normalized = (topArr as any[]).slice(0,5).map((it) => ({
      issueId: it.issue_id || it['issue.id'] || it.issue || '',
      title: it.title || '제목 없음',
      events: it.event_count ?? it.events ?? 0,
      users: it.users ?? (it.user_count ?? null),
      link: it.link || '',
    }))
    return NextResponse.json(createApiResponse({ platform, dateKey, top: normalized }))
  } catch (e:any) {
    return NextResponse.json(createApiError(e.message || 'failed'), { status: 500 })
  }
}

