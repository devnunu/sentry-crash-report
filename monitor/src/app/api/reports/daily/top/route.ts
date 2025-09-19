import { NextRequest, NextResponse } from 'next/server'
import { reportsDb } from '@/lib/reports/database'
import { createApiResponse, createApiError } from '@/lib/utils'

type RawTopIssue = Record<string, unknown>

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
}

const toNullableNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const pickString = (value: unknown, fallback = ''): string => {
  return typeof value === 'string' ? value : fallback
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const platform = (searchParams.get('platform') as 'android'|'ios') || 'android'
    const reports = await reportsDb.getReportExecutions('daily', 1, 0, platform)
    if (reports.length === 0) {
      return NextResponse.json(createApiResponse({ platform, top: [], message: 'no report' }))
    }
    const exec = reports[0]
    const data = (exec.result_data ?? {}) as Record<string, unknown>
    const dateKey = exec.target_date
    const dayEntryRaw = dateKey && dateKey in data ? data[dateKey] : data['today']
    const dayEntry = isRecord(dayEntryRaw) ? dayEntryRaw : undefined
    const topField = dayEntry ? dayEntry['top_5_issues'] : undefined
    const topArrayRaw = Array.isArray(topField) ? (topField as RawTopIssue[]) : []

    const normalized = topArrayRaw.slice(0, 5).map((item) => {
      const record = isRecord(item) ? item : {}
      const issueId = pickString(record.issue_id) || pickString(record['issue.id']) || pickString(record.issue)
      const title = pickString(record.title) || pickString(record.culprit) || pickString(record.message, '제목 없음')
      const events = toNumber(record.event_count ?? record.events)
      const users = toNullableNumber(record.users ?? record.user_count)
      const link = pickString(record.link)
      return {
        issueId,
        title,
        events,
        users,
        link,
      }
    })
    return NextResponse.json(createApiResponse({ platform, dateKey, top: normalized }))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed'
    return NextResponse.json(createApiError(message), { status: 500 })
  }
}
