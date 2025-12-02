/**
 * Sentry Hybrid Service
 *
 * MCP를 우선적으로 사용하고, MCP에서 지원하지 않는 기능은 HTTP fallback 사용
 *
 * MCP 지원 기능:
 * - list_projects: 프로젝트 목록
 * - list_project_issues: 이슈 목록
 * - get_sentry_issue: 이슈 상세
 * - resolve_short_id: Short ID 해석
 * - list_issue_events: 이슈 이벤트 목록
 * - get_sentry_event: 이벤트 상세
 *
 * HTTP Fallback 필요 기능:
 * - 릴리즈 목록/매칭
 * - 윈도우 집계 (Discover API)
 * - Crash-Free Rate (Sessions API)
 * - 시간대별 추이 (Events Stats API)
 */

import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js'
import {getPlatformEnvOrDefault, getRequiredEnv, getRequiredPlatformEnv} from './utils'
import type {Platform, TopIssue, WindowAggregation} from './types'

// 환경 변수로 MCP 사용 여부 제어
const USE_MCP = process.env.USE_SENTRY_MCP !== 'false'

// MCP 클라이언트 싱글톤
let mcpClient: Client | null = null
let mcpTransport: StdioClientTransport | null = null
let mcpConnectionFailed = false

// Sentry API 설정 (HTTP fallback용)
const SENTRY_API_BASE = 'https://sentry.io/api/0'

// MCP 도구 응답 타입
interface MCPToolResult {
  content: Array<{
    type: string
    text?: string
  }>
  isError?: boolean
}

// Sentry 응답 타입들
interface SentryRelease {
  version: string
  shortVersion?: string
  dateReleased?: string | null
  dateCreated: string
  projects?: SentryReleaseProject[]
  deploys?: SentryReleaseDeploy[]
  lastDeploy?: SentryReleaseDeploy | null
  environments?: string[]
}

interface SentryReleaseProject {
  slug: string
  lastDeploy?: SentryReleaseDeploy | null
  latestDeploys?: Array<SentryReleaseDeploy | null>
  environments?: string[]
}

interface SentryReleaseDeploy {
  environment?: string | null
}

interface SentryProject {
  id: string
  slug: string
  name?: string
}

interface SentryIssue {
  id: string
  shortId: string
  title: string
  level: string
  status: string
  count: number
  userCount: number
  firstSeen: string
  lastSeen: string
  permalink: string
}

interface SentryEventsResponse {
  data: Array<{
    'count()': string
    'count_unique(issue)': string
    'count_unique(user)': string
  }>
}

interface SentryTopIssuesResponse {
  data: Array<{
    'issue.id': string
    issue: string
    title: string
    'count()': string
    'count_unique(user)': string
  }>
}

// MCP 클라이언트 초기화
async function getMCPClient(): Promise<Client | null> {
  if (!USE_MCP) {
    return null
  }

  if (mcpConnectionFailed) {
    return null
  }

  if (mcpClient) {
    return mcpClient
  }

  try {
    const token = getRequiredEnv('SENTRY_AUTH_TOKEN')

    mcpTransport = new StdioClientTransport({
      command: 'npx',
      args: ['@sentry/mcp-server@latest', `--access-token=${token}`],
      env: {
        ...process.env,
        SENTRY_AUTH: token
      }
    })

    mcpClient = new Client({
      name: 'sentry-monitor-client',
      version: '1.0.0'
    })

    await mcpClient.connect(mcpTransport)
    console.log('[Sentry Hybrid] MCP client connected successfully')

    return mcpClient
  } catch (error) {
    console.warn('[Sentry Hybrid] MCP connection failed, using HTTP fallback:', error)
    mcpConnectionFailed = true
    return null
  }
}

// MCP 클라이언트 종료
export async function closeMCPClient(): Promise<void> {
  if (mcpClient) {
    await mcpClient.close()
    mcpClient = null
    mcpTransport = null
    console.log('[Sentry Hybrid] MCP client closed')
  }
}

// MCP 도구 호출 헬퍼
async function callMCPTool<T>(toolName: string, args: Record<string, unknown>): Promise<T | null> {
  const client = await getMCPClient()
  if (!client) {
    return null
  }

  try {
    console.log(`[Sentry MCP] Calling tool: ${toolName}`)

    const result = await client.callTool({
      name: toolName,
      arguments: args
    }) as MCPToolResult

    if (result.isError) {
      console.warn(`[Sentry MCP] Tool error: ${result.content?.[0]?.text}`)
      return null
    }

    const textContent = result.content?.find(c => c.type === 'text')
    if (textContent?.text) {
      try {
        return JSON.parse(textContent.text) as T
      } catch {
        return textContent.text as unknown as T
      }
    }

    return null
  } catch (error) {
    console.warn(`[Sentry MCP] Tool call failed:`, error)
    return null
  }
}

// Sentry Hybrid 서비스 클래스
export class SentryHybridService {
  private projectId: string | null = null
  private platform: Platform

  constructor(platform: Platform = 'android') {
    this.platform = platform
  }

  private getBuildNumber(version: string): number {
    const plusIndex = version.indexOf('+')
    if (plusIndex === -1) return 0
    const build = version.substring(plusIndex + 1)
    const parsed = parseInt(build, 10)
    return Number.isNaN(parsed) ? 0 : parsed
  }

  private getReleaseTimestamp(release: SentryRelease): number {
    const timestamp = release.dateReleased || release.dateCreated
    const date = timestamp ? new Date(timestamp) : null
    return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0
  }

  private getAuthHeaders(): HeadersInit {
    const token = getRequiredEnv('SENTRY_AUTH_TOKEN')
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  }

  private async fetchSentryAPI<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const url = new URL(`${SENTRY_API_BASE}${path}`)

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          if (Array.isArray(value)) {
            value.forEach(v => url.searchParams.append(key, String(v)))
          } else {
            url.searchParams.append(key, String(value))
          }
        }
      })
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: this.getAuthHeaders(),
      signal: AbortSignal.timeout(30000)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Sentry API error ${response.status}: ${errorText}`)
    }

    return response.json()
  }

  // ============================================
  // MCP 우선 사용 메서드들
  // ============================================

  // 프로젝트 ID 해석
  async resolveProjectId(): Promise<string> {
    if (this.projectId) {
      return this.projectId
    }

    const orgSlug = getRequiredEnv('SENTRY_ORG_SLUG')

    // 플랫폼별 PROJECT_ID가 있으면 우선 사용
    const platformProjectId = getRequiredPlatformEnv(this.platform, 'PROJECT_ID')
    if (platformProjectId) {
      this.projectId = platformProjectId
      return platformProjectId
    }

    const projectSlug = getRequiredPlatformEnv(this.platform, 'PROJECT_SLUG')

    // MCP로 프로젝트 목록 조회 시도
    const mcpProjects = await callMCPTool<SentryProject[]>('list_projects', {
      organization_slug: orgSlug
    })

    if (mcpProjects) {
      const project = mcpProjects.find(p => p.slug === projectSlug)
      if (project) {
        this.projectId = project.id
        return project.id
      }
    }

    // HTTP fallback
    console.log('[Sentry Hybrid] Using HTTP fallback for resolveProjectId')
    const projects = await this.fetchSentryAPI<SentryProject[]>(`/organizations/${orgSlug}/projects/`)
    const project = projects.find(p => p.slug === projectSlug)

    if (!project) {
      throw new Error(`Project '${projectSlug}' not found in organization '${orgSlug}'`)
    }

    this.projectId = project.id
    return project.id
  }

  // 프로젝트 이슈 목록 조회 (MCP 우선)
  async listProjectIssues(limit: number = 25): Promise<SentryIssue[]> {
    const orgSlug = getRequiredEnv('SENTRY_ORG_SLUG')
    const projectSlug = getRequiredPlatformEnv(this.platform, 'PROJECT_SLUG')

    // MCP로 이슈 목록 조회 시도
    const mcpIssues = await callMCPTool<SentryIssue[]>('list_project_issues', {
      organization_slug: orgSlug,
      project_slug: projectSlug,
      limit
    })

    if (mcpIssues) {
      return mcpIssues
    }

    // HTTP fallback
    console.log('[Sentry Hybrid] Using HTTP fallback for listProjectIssues')
    const projectId = await this.resolveProjectId()
    return await this.fetchSentryAPI<SentryIssue[]>(
      `/projects/${orgSlug}/${projectSlug}/issues/`,
      { limit }
    )
  }

  // 이슈 상세 조회 (MCP 우선)
  async getIssue(issueId: string): Promise<SentryIssue | null> {
    // MCP로 이슈 상세 조회 시도
    const mcpIssue = await callMCPTool<SentryIssue>('get_sentry_issue', {
      issue_id: issueId
    })

    if (mcpIssue) {
      return mcpIssue
    }

    // HTTP fallback
    console.log('[Sentry Hybrid] Using HTTP fallback for getIssue')
    try {
      return await this.fetchSentryAPI<SentryIssue>(`/issues/${issueId}/`)
    } catch (error) {
      console.error('[Sentry Hybrid] Failed to get issue:', error)
      return null
    }
  }

  // Short ID 해석 (MCP 우선)
  async resolveShortId(shortId: string): Promise<SentryIssue | null> {
    const orgSlug = getRequiredEnv('SENTRY_ORG_SLUG')

    // MCP로 Short ID 해석 시도
    const mcpIssue = await callMCPTool<SentryIssue>('resolve_short_id', {
      organization_slug: orgSlug,
      short_id: shortId
    })

    if (mcpIssue) {
      return mcpIssue
    }

    // HTTP fallback
    console.log('[Sentry Hybrid] Using HTTP fallback for resolveShortId')
    try {
      const result = await this.fetchSentryAPI<{ group: SentryIssue }>(
        `/organizations/${orgSlug}/shortids/${shortId}/`
      )
      return result.group
    } catch (error) {
      console.error('[Sentry Hybrid] Failed to resolve short ID:', error)
      return null
    }
  }

  // ============================================
  // HTTP 전용 메서드들 (MCP 미지원)
  // ============================================

  // 릴리즈 목록 조회
  async listReleases(perPage: number = 100, maxPages: number = 10): Promise<SentryRelease[]> {
    const orgSlug = getRequiredEnv('SENTRY_ORG_SLUG')
    const projectId = await this.resolveProjectId()

    const releases: SentryRelease[] = []
    let cursor: string | null = null
    let pages = 0

    while (pages < maxPages) {
      const params: Record<string, string> = {
        project: projectId,
        per_page: Math.min(Math.max(perPage, 1), 100).toString()
      }

      if (cursor) {
        params.cursor = cursor
      }

      const response = await fetch(
        `${SENTRY_API_BASE}/organizations/${orgSlug}/releases/?` + new URLSearchParams(params),
        { headers: this.getAuthHeaders() }
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch releases: ${response.status}`)
      }

      const data = await response.json() as SentryRelease[]
      releases.push(...data)

      const linkHeader = response.headers.get('link')
      if (linkHeader && linkHeader.includes('rel="next"') && linkHeader.includes('results="true"')) {
        const cursorMatch = linkHeader.match(/cursor="?([^">]+)"?/)
        cursor = cursorMatch ? cursorMatch[1] : null

        if (cursor && cursor.includes(':-1:')) {
          cursor = null
        }
      } else {
        cursor = null
      }

      pages++

      if (!cursor || data.length === 0) {
        break
      }
    }

    return releases
  }

  private async getReleaseDetail(version: string): Promise<SentryRelease | null> {
    const orgSlug = getRequiredEnv('SENTRY_ORG_SLUG')
    const projectId = await this.resolveProjectId()

    try {
      const release = await this.fetchSentryAPI<SentryRelease>(
        `/organizations/${orgSlug}/releases/${encodeURIComponent(version)}/`,
        { project: projectId }
      )
      return release
    } catch (error) {
      console.error(`Failed to get release detail for ${version}:`, error)
      return null
    }
  }

  private releaseIncludesProject(detail: SentryRelease, projectSlug: string): boolean {
    if (!detail.projects || detail.projects.length === 0) {
      return true
    }
    return detail.projects.some(project => project?.slug === projectSlug)
  }

  private releaseMatchesEnvironment(detail: SentryRelease, targetEnv: string): boolean {
    if (!targetEnv) {
      return true
    }

    const envSet = new Set<string>()

    const pushEnv = (env?: string | null) => {
      if (!env) return
      envSet.add(env.trim().toLowerCase())
    }

    if (Array.isArray(detail.environments)) {
      detail.environments.forEach(env => pushEnv(env))
    }

    if (detail.deploys) {
      detail.deploys.forEach(deploy => pushEnv(deploy?.environment ?? undefined))
    }

    if (detail.lastDeploy) {
      pushEnv(detail.lastDeploy.environment ?? undefined)
    }

    if (detail.projects) {
      detail.projects.forEach(project => {
        if (!project) return
        pushEnv(project.lastDeploy?.environment ?? undefined)
        if (Array.isArray(project.latestDeploys)) {
          project.latestDeploys.forEach(deploy => pushEnv(deploy?.environment ?? undefined))
        }
        if (Array.isArray(project.environments)) {
          project.environments.forEach(env => pushEnv(env))
        }
      })
    }

    return envSet.size === 0 ? false : envSet.has(targetEnv)
  }

  // 베이스 릴리즈와 매칭되는 전체 버전 찾기
  async matchFullRelease(baseRelease: string): Promise<string | null> {
    const semverPattern = /^\d+\.\d+\.\d+$/
    if (!semverPattern.test(baseRelease)) {
      throw new Error(`Invalid base release format: ${baseRelease}. Expected format: x.y.z`)
    }

    const releases = await this.listReleases(100, 10)

    const candidates = releases
      .filter(r => {
        const version = r.version || r.shortVersion || ''
        return version.startsWith(baseRelease)
      })

    if (candidates.length === 0) {
      return null
    }

    const sortedCandidates = candidates.sort((a, b) => {
      const dateA = this.getReleaseTimestamp(a)
      const dateB = this.getReleaseTimestamp(b)
      if (dateA !== dateB) {
        return dateB - dateA
      }
      const buildA = this.getBuildNumber(a.version || a.shortVersion || '')
      const buildB = this.getBuildNumber(b.version || b.shortVersion || '')
      return buildB - buildA
    })

    const targetEnv = getPlatformEnvOrDefault(this.platform, 'SENTRY_ENVIRONMENT', '').trim().toLowerCase()
    const projectSlug = getRequiredPlatformEnv(this.platform, 'PROJECT_SLUG')

    for (const candidate of sortedCandidates) {
      const version = candidate.version || candidate.shortVersion
      if (!version) {
        continue
      }

      const detail = await this.getReleaseDetail(version)
      if (!detail) {
        continue
      }

      if (!this.releaseIncludesProject(detail, projectSlug)) {
        continue
      }

      if (!targetEnv) {
        return detail.version
      }

      if (this.releaseMatchesEnvironment(detail, targetEnv)) {
        return detail.version
      }
    }

    const fallback = sortedCandidates[0]
    return fallback.version || fallback.shortVersion || null
  }

  // 릴리즈 생성/배포 시간 조회
  async getReleaseCreatedAt(version: string): Promise<Date | null> {
    const detail = await this.getReleaseDetail(version)
    const timestamp = detail?.dateReleased || detail?.dateCreated
    return timestamp ? new Date(timestamp) : null
  }

  // 윈도우 집계 데이터 조회 (HTTP only - Discover API)
  async getWindowAggregates(
    releaseVersion: string,
    startTime: Date,
    endTime: Date
  ): Promise<WindowAggregation> {
    const orgSlug = getRequiredEnv('SENTRY_ORG_SLUG')
    const projectId = await this.resolveProjectId()

    const environment = getPlatformEnvOrDefault(this.platform, 'SENTRY_ENVIRONMENT', 'production')
    const query = [
      'level:[error,fatal]',
      releaseVersion ? `release:${releaseVersion}` : '',
      environment ? `environment:${environment}` : ''
    ].filter(Boolean).join(' ')

    const params = {
      field: ['count()', 'count_unique(issue)', 'count_unique(user)'],
      project: projectId,
      start: startTime.toISOString(),
      end: endTime.toISOString(),
      query,
      referrer: 'api.release.monitor.agg'
    }

    try {
      const response = await this.fetchSentryAPI<SentryEventsResponse>(
        `/organizations/${orgSlug}/events/`,
        params
      )

      if (!response.data || response.data.length === 0) {
        return { events: 0, issues: 0, users: 0 }
      }

      const row = response.data[0]
      return {
        events: parseInt(row['count()'] || '0'),
        issues: parseInt(row['count_unique(issue)'] || '0'),
        users: parseInt(row['count_unique(user)'] || '0')
      }
    } catch (error) {
      console.error('[Sentry Hybrid] Failed to get window aggregates:', error)
      return { events: 0, issues: 0, users: 0 }
    }
  }

  // 상위 이슈 목록 조회 (HTTP - Discover API with release filter)
  async getTopIssues(
    releaseVersion: string,
    startTime: Date,
    endTime: Date,
    limit: number = 5
  ): Promise<TopIssue[]> {
    const orgSlug = getRequiredEnv('SENTRY_ORG_SLUG')
    const projectId = await this.resolveProjectId()

    const environment = getPlatformEnvOrDefault(this.platform, 'SENTRY_ENVIRONMENT', 'production')
    const query = [
      'level:[error,fatal]',
      releaseVersion ? `release:${releaseVersion}` : '',
      environment ? `environment:${environment}` : ''
    ].filter(Boolean).join(' ')

    const params = {
      field: ['issue.id', 'issue', 'title', 'count()', 'count_unique(user)'],
      project: projectId,
      start: startTime.toISOString(),
      end: endTime.toISOString(),
      query,
      orderby: '-count()',
      per_page: Math.min(Math.max(limit, 1), 100),
      referrer: 'api.release.monitor.top'
    }

    try {
      const response = await this.fetchSentryAPI<SentryTopIssuesResponse>(
        `/organizations/${orgSlug}/events/`,
        params
      )

      if (!response.data) {
        return []
      }

      return response.data.slice(0, limit).map(row => ({
        issueId: row['issue.id'] || '',
        shortId: row.issue || '',
        title: row.title || '제목 없음',
        events: parseInt(row['count()'] || '0'),
        users: parseInt(row['count_unique(user)'] || '0'),
        link: row['issue.id'] ? `https://sentry.io/organizations/${orgSlug}/issues/${row['issue.id']}/` : ''
      }))
    } catch (error) {
      console.error('[Sentry Hybrid] Failed to get top issues:', error)
      return []
    }
  }

  // 대시보드 및 이슈 필터 URL 생성
  buildActionUrls(
    releaseVersion: string,
    startTime: Date,
    endTime: Date
  ): { dashboard: string; issues: string } {
    const orgSlug = getRequiredEnv('SENTRY_ORG_SLUG')
    const projectId = this.projectId

    const dashboardUrl = getPlatformEnvOrDefault(this.platform, 'DASHBOARD_URL', '') ||
      `https://sentry.io/organizations/${orgSlug}/projects/`

    const environment = getPlatformEnvOrDefault(this.platform, 'SENTRY_ENVIRONMENT', 'production')
    const query = [
      'level:[error,fatal]',
      releaseVersion ? `release:${releaseVersion}` : '',
      environment ? `environment:${environment}` : ''
    ].filter(Boolean).join(' ')

    const params = new URLSearchParams({
      project: projectId || '',
      query,
      start: startTime.toISOString(),
      end: endTime.toISOString()
    })

    const issuesUrl = `https://sentry.io/organizations/${orgSlug}/issues/?${params.toString()}`

    return {
      dashboard: dashboardUrl,
      issues: issuesUrl
    }
  }

  // Crash-Free Rate 조회 (HTTP only - Sessions API)
  async getCrashFreeRate(
    releaseVersion: string,
    startTime: Date,
    endTime: Date
  ): Promise<{ crashFreeRate: number; crashFreeSessionRate: number }> {
    const orgSlug = getRequiredEnv('SENTRY_ORG_SLUG')
    const projectId = await this.resolveProjectId()

    const environment = getPlatformEnvOrDefault(this.platform, 'SENTRY_ENVIRONMENT', 'production')

    try {
      const queryParts = [
        releaseVersion ? `release:${releaseVersion}` : '',
        environment ? `environment:${environment}` : ''
      ].filter(Boolean).join(' ')

      const params = {
        field: ['crash_free_rate(user)', 'crash_free_rate(session)'],
        groupBy: releaseVersion ? ['release'] : [],
        project: projectId,
        start: startTime.toISOString(),
        end: endTime.toISOString(),
        query: queryParts || undefined,
        statsPeriod: '14d',
        interval: '1d'
      }

      const response = await this.fetchSentryAPI<any>(
        `/organizations/${orgSlug}/sessions/`,
        params
      )

      const totals = response.groups && response.groups.length > 0
        ? response.groups[0].totals
        : response.totals

      if (totals) {
        let crashFreeRate = totals?.['crash_free_rate(user)'] ?? 99.9
        let crashFreeSessionRate = totals?.['crash_free_rate(session)'] ?? 99.9

        if (typeof crashFreeRate === 'number' && crashFreeRate <= 1) {
          crashFreeRate = crashFreeRate * 100
        }
        if (typeof crashFreeSessionRate === 'number' && crashFreeSessionRate <= 1) {
          crashFreeSessionRate = crashFreeSessionRate * 100
        }

        return {
          crashFreeRate: typeof crashFreeRate === 'number' ? crashFreeRate : 99.9,
          crashFreeSessionRate: typeof crashFreeSessionRate === 'number' ? crashFreeSessionRate : 99.9
        }
      }

      return { crashFreeRate: 99.9, crashFreeSessionRate: 99.9 }
    } catch (error) {
      console.error('[Sentry Hybrid] Failed to get crash-free rates:', error)
      return { crashFreeRate: 99.9, crashFreeSessionRate: 99.9 }
    }
  }

  // 상세 이슈 정보 조회
  async getDetailedTopIssues(
    releaseVersion: string,
    startTime: Date,
    endTime: Date,
    previousCheckTime: Date | null,
    limit: number = 10
  ): Promise<Array<{
    id: string
    title: string
    count: number
    users: number
    level: 'fatal' | 'error'
    isNew: boolean
    firstSeen: string
    lastSeen: string
    link: string
  }>> {
    const orgSlug = getRequiredEnv('SENTRY_ORG_SLUG')
    const projectId = await this.resolveProjectId()

    const environment = getPlatformEnvOrDefault(this.platform, 'SENTRY_ENVIRONMENT', 'production')
    const query = [
      'level:[error,fatal]',
      releaseVersion ? `release:${releaseVersion}` : '',
      environment ? `environment:${environment}` : ''
    ].filter(Boolean).join(' ')

    const params = {
      field: ['issue.id', 'issue', 'title', 'count()', 'count_unique(user)', 'level', 'firstSeen', 'lastSeen'],
      project: projectId,
      start: startTime.toISOString(),
      end: endTime.toISOString(),
      query,
      orderby: '-count()',
      per_page: Math.min(Math.max(limit, 1), 100),
      referrer: 'api.release.monitor.detailed'
    }

    try {
      const response = await this.fetchSentryAPI<any>(
        `/organizations/${orgSlug}/events/`,
        params
      )

      if (!response.data) {
        return []
      }

      return response.data.slice(0, limit).map((row: any) => {
        const firstSeenDate = row.firstSeen ? new Date(row.firstSeen) : new Date(startTime)
        const isNew = previousCheckTime ? firstSeenDate > previousCheckTime : false

        return {
          id: row['issue.id'] || '',
          title: row.title || '제목 없음',
          count: parseInt(row['count()'] || '0'),
          users: parseInt(row['count_unique(user)'] || '0'),
          level: (row.level === 'fatal' ? 'fatal' : 'error') as 'fatal' | 'error',
          isNew,
          firstSeen: row.firstSeen || startTime.toISOString(),
          lastSeen: row.lastSeen || endTime.toISOString(),
          link: row['issue.id'] ? `https://sentry.io/organizations/${orgSlug}/issues/${row['issue.id']}/` : ''
        }
      })
    } catch (error) {
      console.error('[Sentry Hybrid] Failed to get detailed top issues:', error)
      return []
    }
  }

  // 시간대별 크래시 추이 조회 (HTTP only - Events Stats API)
  async getHourlyTrend(
    releaseVersion: string,
    endTime: Date,
    hours: number = 24
  ): Promise<Array<{ hour: string; crashes: number }>> {
    const orgSlug = getRequiredEnv('SENTRY_ORG_SLUG')
    const projectId = await this.resolveProjectId()

    const startTime = new Date(endTime.getTime() - hours * 60 * 60 * 1000)
    const environment = getPlatformEnvOrDefault(this.platform, 'SENTRY_ENVIRONMENT', 'production')
    const query = [
      'level:[error,fatal]',
      releaseVersion ? `release:${releaseVersion}` : '',
      environment ? `environment:${environment}` : ''
    ].filter(Boolean).join(' ')

    const params = {
      field: ['count()'],
      project: projectId,
      start: startTime.toISOString(),
      end: endTime.toISOString(),
      query,
      interval: '1h',
      referrer: 'api.release.monitor.trend'
    }

    try {
      const response = await this.fetchSentryAPI<any>(
        `/organizations/${orgSlug}/events-stats/`,
        params
      )

      if (response.data && Array.isArray(response.data)) {
        return response.data.map((point: any) => {
          const timestamp = Array.isArray(point) ? point[0] : point.time
          const count = Array.isArray(point) ? (point[1]?.[0]?.count ?? 0) : (point.count ?? 0)
          const date = new Date(timestamp * 1000)
          const hour = `${date.getHours().toString().padStart(2, '0')}:00`

          return {
            hour,
            crashes: count
          }
        })
      }

      return []
    } catch (error) {
      console.error('[Sentry Hybrid] Failed to get hourly trend:', error)
      return []
    }
  }
}

// 플랫폼별 Hybrid 서비스 인스턴스 생성 함수
export function createSentryHybridService(platform: Platform): SentryHybridService {
  return new SentryHybridService(platform)
}

// 기본 인스턴스 (Android)
export const sentryHybridService = new SentryHybridService('android')
