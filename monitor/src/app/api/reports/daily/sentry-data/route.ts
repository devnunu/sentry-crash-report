import { NextRequest, NextResponse } from 'next/server'
import type { Platform } from '@/lib/types'
import { addDays, format } from 'date-fns'
import { getRequiredEnv, getPlatformEnv } from '@/lib/utils'

export const dynamic = 'force-dynamic'

interface SentryIssue {
  id: string
  shortId: string
  title: string
  culprit?: string
  count: string
  userCount: number | null
  permalink: string
  level?: string
  status?: string
  isUnhandled?: boolean
  firstSeen?: string
  lastSeen?: string
}

interface DayStat {
  date: string
  events: number
  issues: number
  users: number
  crashFreeRate: number
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const platform = searchParams.get('platform') as Platform
    const targetDate = searchParams.get('targetDate')

    if (!platform || !['android', 'ios'].includes(platform)) {
      return NextResponse.json(
        { success: false, error: 'Invalid platform parameter' },
        { status: 400 }
      )
    }

    if (!targetDate) {
      return NextResponse.json(
        { success: false, error: 'targetDate parameter is required' },
        { status: 400 }
      )
    }

    // Get environment variables for the platform
    const token = getRequiredEnv('SENTRY_AUTH_TOKEN')
    const org = getRequiredEnv('SENTRY_ORG_SLUG')
    const projectSlug = getPlatformEnv(platform, 'PROJECT_SLUG')
    const projectIdEnv = getPlatformEnv(platform, 'PROJECT_ID')
    const environment = getPlatformEnv(platform, 'SENTRY_ENVIRONMENT') || 'production'

    if (!projectSlug && !projectIdEnv) {
      return NextResponse.json(
        { success: false, error: 'Sentry configuration missing' },
        { status: 500 }
      )
    }

    // Resolve project ID
    let projectId: number
    if (projectIdEnv) {
      projectId = parseInt(projectIdEnv)
    } else {
      // Fetch project ID from API
      const projectsResponse = await fetch(`https://sentry.io/api/0/organizations/${org}/projects/`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      if (!projectsResponse.ok) {
        throw new Error(`Failed to fetch projects: ${projectsResponse.status}`)
      }

      const projects = await projectsResponse.json()
      const project = projects.find((p: any) => p.slug === projectSlug)

      if (!project) {
        throw new Error(`Project ${projectSlug} not found`)
      }

      projectId = parseInt(project.id)
    }

    // Calculate date range (last 7 days from target date)
    const targetDateObj = new Date(targetDate + 'T00:00:00Z')
    const startDate = addDays(targetDateObj, -6) // 6 days before target date

    // Fetch last 7 days stats
    const last7DaysData: DayStat[] = []

    for (let i = 0; i < 7; i++) {
      const currentDate = addDays(startDate, i)
      const dateStr = format(currentDate, 'yyyy-MM-dd')
      const dayStart = new Date(dateStr + 'T00:00:00Z')
      const dayEnd = new Date(dateStr + 'T23:59:59Z')
      const startIso = dayStart.toISOString()
      const endIso = dayEnd.toISOString()

      try {
        // Get project stats for the day
        const query = 'level:[error,fatal]' + (environment ? ` environment:${environment}` : '')
        const statsParams = new URLSearchParams({
          field: 'count()',
          project: projectId.toString(),
          start: startIso,
          end: endIso,
          query,
          referrer: 'api.summaries.daily'
        })
        statsParams.append('field', 'count_unique(issue)')
        statsParams.append('field', 'count_unique(user)')

        const statsResponse = await fetch(
          `https://sentry.io/api/0/organizations/${org}/events/?${statsParams}`,
          {
            headers: { 'Authorization': `Bearer ${token}` }
          }
        )

        if (!statsResponse.ok) {
          throw new Error(`Stats fetch failed: ${statsResponse.status}`)
        }

        const statsData = await statsResponse.json()
        const rows = statsData.data || []

        let totalEvents = 0
        let uniqueIssues = 0
        let impactedUsers = 0

        if (rows.length > 0) {
          const row0 = rows[0]
          totalEvents = parseInt(String(row0['count()'] || 0))
          uniqueIssues = parseInt(String(row0['count_unique(issue)'] || 0))
          impactedUsers = parseInt(String(row0['count_unique(user)'] || 0))
        }

        // Get session stats for crash free rate
        const sessionParams = new URLSearchParams({
          project: projectId.toString(),
          start: startIso,
          end: endIso,
          interval: '1d',
          field: 'crash_free_rate(session)',
          referrer: 'api.summaries.daily'
        })
        sessionParams.append('field', 'crash_free_rate(user)')
        if (environment) {
          sessionParams.set('environment', environment)
        }

        const sessionResponse = await fetch(
          `https://sentry.io/api/0/organizations/${org}/sessions/?${sessionParams}`,
          {
            headers: { 'Authorization': `Bearer ${token}` }
          }
        )

        let crashFreeRate = 99.9
        if (sessionResponse.ok) {
          const sessionData = await sessionResponse.json()
          for (const g of sessionData.groups || []) {
            const series = g.series || {}
            if (series['crash_free_rate(user)']?.length) {
              crashFreeRate = parseFloat(String(series['crash_free_rate(user)'].slice(-1)[0]))
              break
            }
          }
        }

        last7DaysData.push({
          date: dateStr,
          events: totalEvents,
          issues: uniqueIssues,
          users: impactedUsers,
          crashFreeRate
        })
      } catch (error) {
        console.error(`Failed to fetch data for ${dateStr}:`, error)
        // Add zero data for failed dates
        last7DaysData.push({
          date: dateStr,
          events: 0,
          issues: 0,
          users: 0,
          crashFreeRate: 0
        })
      }
    }

    // Fetch detailed issues for the target date
    const targetDayStart = new Date(targetDate + 'T00:00:00Z')
    const targetDayEnd = new Date(targetDate + 'T23:59:59Z')
    const targetStartIso = targetDayStart.toISOString()
    const targetEndIso = targetDayEnd.toISOString()

    const query = 'level:[error,fatal]' + (environment ? ` environment:${environment}` : '')
    const issuesParams = new URLSearchParams({
      project: projectId.toString(),
      since: targetStartIso,
      until: targetEndIso,
      query,
      sort: 'freq',
      per_page: '100',
      referrer: 'api.summaries.issues'
    })

    const issuesResponse = await fetch(
      `https://sentry.io/api/0/organizations/${org}/issues/?${issuesParams}`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    )

    if (!issuesResponse.ok) {
      throw new Error(`Issues fetch failed: ${issuesResponse.status}`)
    }

    const targetIssues = await issuesResponse.json() as SentryIssue[]

    // Get previous day issues for comparison
    const prevDayStart = addDays(targetDateObj, -1)
    const prevDayEnd = new Date(format(prevDayStart, 'yyyy-MM-dd') + 'T23:59:59Z')
    const prevStartIso = prevDayStart.toISOString()
    const prevEndIso = prevDayEnd.toISOString()

    const prevIssuesParams = new URLSearchParams({
      project: projectId.toString(),
      since: prevStartIso,
      until: prevEndIso,
      query,
      sort: 'freq',
      per_page: '100',
      referrer: 'api.summaries.issues'
    })

    const prevIssuesResponse = await fetch(
      `https://sentry.io/api/0/organizations/${org}/issues/?${prevIssuesParams}`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    )

    let prevIssues: SentryIssue[] = []
    if (prevIssuesResponse.ok) {
      prevIssues = await prevIssuesResponse.json()
    }

    // Transform issues data
    const issuesWithMetadata = targetIssues.map((issue: SentryIssue) => {
      const prevIssue = prevIssues.find((p: SentryIssue) => p.id === issue.id)
      const currentCount = parseInt(issue.count) || 0
      const prevCount = prevIssue ? (parseInt(prevIssue.count) || 0) : 0
      const delta = prevCount > 0 ? ((currentCount - prevCount) / prevCount) * 100 : 0

      // Check if it's a new issue (first seen today)
      const firstSeenDate = issue.firstSeen ? new Date(issue.firstSeen) : null
      const isNew = firstSeenDate ?
        format(firstSeenDate, 'yyyy-MM-dd') === targetDate : false

      // Check if it's a surge (2x increase or more)
      const isSurge = delta >= 100

      return {
        id: issue.id,
        shortId: issue.shortId,
        title: issue.title,
        culprit: issue.culprit,
        count: currentCount,
        users: issue.userCount || 0,
        link: issue.permalink,
        level: issue.level,
        status: issue.status,
        isNew,
        isSurge,
        delta,
        firstSeen: issue.firstSeen,
        lastSeen: issue.lastSeen
      }
    })

    return NextResponse.json({
      success: true,
      data: {
        last7DaysData,
        issues: issuesWithMetadata,
        totalEvents: last7DaysData[last7DaysData.length - 1]?.events || 0,
        totalIssues: issuesWithMetadata.length,
        totalUsers: issuesWithMetadata.reduce((sum, issue) => sum + issue.users, 0)
      }
    })
  } catch (error) {
    console.error('Sentry data fetch error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch Sentry data'
      },
      { status: 500 }
    )
  }
}
