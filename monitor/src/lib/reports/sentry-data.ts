import {getPlatformEnv, getPlatformEnvOrDefault, getRequiredEnv} from '../utils'
import {formatKSTDate, getKSTDayBounds} from './utils'
import type {Platform} from '../types'

interface Aggregates {
  crash_events: number
  unique_issues: number
  impacted_users: number
}

interface DayMetrics extends Aggregates {
  window_utc: { start: string; end: string }
  date_kst: string
}

export class SentryDataService {
  private platform: Platform
  private token!: string
  private org!: string
  private projectId!: number
  private environment!: string | null

  constructor(platform: Platform) {
    this.platform = platform
  }

  private async ensureConfigured(): Promise<void> {
    if (this.token && this.org && this.projectId !== undefined) return
    this.token = getRequiredEnv('SENTRY_AUTH_TOKEN')
    this.org = getRequiredEnv('SENTRY_ORG_SLUG')
    const projectSlug = getPlatformEnv(this.platform, 'PROJECT_SLUG')
    const projectIdEnv = getPlatformEnv(this.platform, 'PROJECT_ID')
    this.environment = getPlatformEnvOrDefault(this.platform, 'SENTRY_ENVIRONMENT', 'production')
    this.projectId = await this.resolveProjectId(this.token, this.org, projectSlug, projectIdEnv)
  }

  private async resolveProjectId(
    token: string,
    org: string,
    projectSlug?: string | null,
    projectIdEnv?: string | null
  ): Promise<number> {
    if (projectIdEnv) return parseInt(projectIdEnv)
    if (!projectSlug) throw new Error(`${this.platform.toUpperCase()}_PROJECT_SLUG 또는 ${this.platform.toUpperCase()}_PROJECT_ID 중 하나는 필요합니다.`)

    const resp = await fetch(`https://sentry.io/api/0/organizations/${org}/projects/`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 30000
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status} for GET projects`)
    const projects = await resp.json()
    for (const p of projects) {
      if (p.slug === projectSlug) return parseInt(p.id)
    }
    throw new Error(`'${projectSlug}' 프로젝트를 찾을 수 없습니다.`)
  }

  private async discoverAggregatesForDay(startIsoUtc: string, endIsoUtc: string): Promise<Aggregates> {
    const query = 'level:[error,fatal]' + (this.environment ? ` environment:${this.environment}` : '')
    const params = new URLSearchParams({
      field: 'count()',
      project: String(this.projectId),
      start: startIsoUtc,
      end: endIsoUtc,
      query,
      referrer: 'api.summaries.daily'
    })
    params.append('field', 'count_unique(issue)')
    params.append('field', 'count_unique(user)')

    const resp = await fetch(`https://sentry.io/api/0/organizations/${this.org}/events/?${params}`, {
      headers: { Authorization: `Bearer ${this.token}` },
      timeout: 60000
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status} for GET events aggregates`)
    const data = await resp.json()
    const rows = data.data || []
    if (!rows.length) return { crash_events: 0, unique_issues: 0, impacted_users: 0 }
    const row0 = rows[0]
    return {
      crash_events: parseInt(String(row0['count()'] || 0)),
      unique_issues: parseInt(String(row0['count_unique(issue)'] || 0)),
      impacted_users: parseInt(String(row0['count_unique(user)'] || 0))
    }
  }

  async getDayMetrics(date: Date): Promise<DayMetrics> {
    await this.ensureConfigured()
    const bounds = getKSTDayBounds(date)
    const startIso = bounds.start.toISOString().replace('+00:00', 'Z')
    const endIso = bounds.end.toISOString().replace('+00:00', 'Z')

    const agg = await this.discoverAggregatesForDay(startIso, endIso)

    return {
      date_kst: formatKSTDate(date),
      ...agg,
      window_utc: { start: startIso, end: endIso }
    }
  }

  async getIssuesForDay(date: Date, limit: number = 200): Promise<Array<{ id: string; title: string; count: number; users: number; link: string }>> {
    await this.ensureConfigured()
    const bounds = getKSTDayBounds(date)
    const startIso = bounds.start.toISOString().replace('+00:00', 'Z')
    const endIso = bounds.end.toISOString().replace('+00:00', 'Z')

    const query = 'level:[error,fatal]' + (this.environment ? ` environment:${this.environment}` : '')

    const results: Array<{ id: string; title: string; count: number; users: number; link: string }> = []
    let cursor: string | null = null
    let fetched = 0

    while (true) {
      const params = new URLSearchParams({
        field: 'issue',
        project: String(this.projectId),
        start: startIso,
        end: endIso,
        query,
        orderby: '-count()',
        per_page: '100',
        referrer: 'api.summaries.day-issues'
      })
      params.append('field', 'title')
      params.append('field', 'count()')
      params.append('field', 'count_unique(user)')
      if (cursor) params.set('cursor', cursor)

      const url = `https://sentry.io/api/0/organizations/${this.org}/events/?${params}`
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` }, timeout: 60000 })
      if (!resp.ok) throw new Error(`HTTP ${resp.status} for GET day issues`)

      const data = await resp.json()
      const rows = (data.data || []) as Array<any>

      for (const row of rows) {
        if (!row.issue) continue
        results.push({
          id: String(row.issue),
          title: row.title,
          count: parseInt(String(row['count()'] || 0)),
          users: parseInt(String(row['count_unique(user)'] || 0)),
          link: row.issue ? `https://sentry.io/organizations/${this.org}/issues/${row.issue}/` : '#'
        })
        fetched++
        if (limit > 0 && fetched >= limit) break
      }

      if (limit > 0 && fetched >= limit) break

      const linkHeader = resp.headers.get('link') || ''
      // Parse Sentry pagination link header
      // Example: <https://...&cursor=xyz:0:1>; rel="previous"; results="false"; cursor="xyz:0:1", <https://...&cursor=abc:0:0>; rel="next"; results="true"; cursor="abc:0:0"
      let nextCursor: string | null = null
      const parts = linkHeader.split(',')
      for (const p of parts) {
        if (p.includes('rel="next"') && p.includes('results="true"')) {
          const m = p.match(/cursor=([^&>]+)[&>]/)
          if (m) nextCursor = m[1]
        }
      }
      cursor = nextCursor
      if (!cursor) break
    }

    return results
  }
}
