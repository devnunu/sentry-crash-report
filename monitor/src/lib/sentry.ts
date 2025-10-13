import { getRequiredEnv, getRequiredPlatformEnv, getPlatformEnvOrDefault } from './utils'
import type { WindowAggregation, TopIssue, Platform } from './types'

// Sentry API 설정
const SENTRY_API_BASE = 'https://sentry.io/api/0'

// Sentry API 응답 타입들
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

interface SentryReleaseDetail extends SentryRelease {}

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

interface SentryProject {
  id: string
  slug: string
}

export class SentryService {
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
      // Vercel 환경에서 timeout 설정
      signal: AbortSignal.timeout(30000)
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Sentry API error ${response.status}: ${errorText}`)
    }
    
    return response.json()
  }
  
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
    
    // PROJECT_ID가 없으면 PROJECT_SLUG로 조회
    const projectSlug = getRequiredPlatformEnv(this.platform, 'PROJECT_SLUG')
    
    try {
      const projects = await this.fetchSentryAPI<SentryProject[]>(`/organizations/${orgSlug}/projects/`)
      
      const project = projects.find(p => p.slug === projectSlug)
      if (!project) {
        throw new Error(`Project '${projectSlug}' not found in organization '${orgSlug}'`)
      }
      
      this.projectId = project.id
      return project.id
    } catch (error) {
      throw new Error(`Failed to resolve project ID: ${error}`)
    }
  }
  
  // 릴리즈 목록 조회 (페이지네이션 포함)
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
      
      // 다음 페이지 cursor 추출
      const linkHeader = response.headers.get('link')
      if (linkHeader && linkHeader.includes('rel="next"') && linkHeader.includes('results="true"')) {
        const cursorMatch = linkHeader.match(/cursor="?([^">]+)"?/)
        cursor = cursorMatch ? cursorMatch[1] : null
        
        // "-1:" 이 포함된 cursor는 마지막 페이지
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

  private async getReleaseDetail(version: string): Promise<SentryReleaseDetail | null> {
    const orgSlug = getRequiredEnv('SENTRY_ORG_SLUG')
    const projectId = await this.resolveProjectId()

    try {
      const release = await this.fetchSentryAPI<SentryReleaseDetail>(
        `/organizations/${orgSlug}/releases/${encodeURIComponent(version)}/`,
        { project: projectId }
      )
      return release
    } catch (error) {
      console.error(`Failed to get release detail for ${version}:`, error)
      return null
    }
  }

  private releaseIncludesProject(detail: SentryReleaseDetail, projectSlug: string): boolean {
    if (!detail.projects || detail.projects.length === 0) {
      return true
    }
    return detail.projects.some(project => project?.slug === projectSlug)
  }

  private releaseMatchesEnvironment(detail: SentryReleaseDetail, targetEnv: string): boolean {
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

  private collectEnvironments(detail: SentryReleaseDetail): string[] {
    const envSet = new Set<string>()

    const pushEnv = (env?: string | null) => {
      if (!env) return
      envSet.add(env.trim())
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

    return Array.from(envSet)
  }

  async searchReleaseCandidates(baseRelease: string, limit: number = 20) {
    const releases = await this.listReleases(100, 10)
    const projectSlug = getRequiredPlatformEnv(this.platform, 'PROJECT_SLUG')
    const targetEnv = getPlatformEnvOrDefault(this.platform, 'SENTRY_ENVIRONMENT', '').trim().toLowerCase()

    const candidates = releases.filter(r => {
      const version = r.version || r.shortVersion || ''
      return version.startsWith(baseRelease)
    })

    const sorted = candidates.sort((a, b) => {
      const tsA = this.getReleaseTimestamp(a)
      const tsB = this.getReleaseTimestamp(b)
      if (tsA !== tsB) {
        return tsB - tsA
      }
      const buildA = this.getBuildNumber(a.version || a.shortVersion || '')
      const buildB = this.getBuildNumber(b.version || b.shortVersion || '')
      return buildB - buildA
    })

    const results: Array<{
      version: string
      dateReleased?: string | null
      dateCreated: string
      environments: string[]
      build: number
      projectMatched: boolean
      environmentMatched: boolean
    }> = []

    for (const candidate of sorted) {
      const version = candidate.version || candidate.shortVersion
      if (!version) continue

      const detail = await this.getReleaseDetail(version)
      if (!detail) continue

      const projectMatch = this.releaseIncludesProject(detail, projectSlug)
      if (!projectMatch) continue

      const envMatched = targetEnv ? this.releaseMatchesEnvironment(detail, targetEnv) : true

      results.push({
        version: detail.version,
        dateReleased: detail.dateReleased ?? null,
        dateCreated: detail.dateCreated,
        environments: this.collectEnvironments(detail),
        build: this.getBuildNumber(detail.version),
        projectMatched: projectMatch,
        environmentMatched: envMatched
      })

      if (results.length >= limit) {
        break
      }
    }

    return results.sort((a, b) => {
      if (a.environmentMatched !== b.environmentMatched) {
        return Number(b.environmentMatched) - Number(a.environmentMatched)
      }
      const timeA = new Date(a.dateReleased || a.dateCreated).getTime()
      const timeB = new Date(b.dateReleased || b.dateCreated).getTime()
      if (timeA !== timeB) {
        return timeB - timeA
      }
      return b.build - a.build
    })
  }

  // 베이스 릴리즈와 매칭되는 전체 버전 찾기
  async matchFullRelease(baseRelease: string): Promise<string | null> {
    // semver core 형식 검증 (x.y.z)
    const semverPattern = /^\d+\.\d+\.\d+$/
    if (!semverPattern.test(baseRelease)) {
      throw new Error(`Invalid base release format: ${baseRelease}. Expected format: x.y.z`)
    }
    
    const releases = await this.listReleases(100, 10)
    
    // 베이스 릴리즈로 시작하는 후보들 찾기
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
  
  // 윈도우 집계 데이터 조회
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
      `release:${releaseVersion}`,
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
      console.error('Failed to get window aggregates:', error)
      return { events: 0, issues: 0, users: 0 }
    }
  }
  
  // 상위 이슈 목록 조회
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
      `release:${releaseVersion}`,
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
      console.error('Failed to get top issues:', error)
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
    
    // 대시보드 URL (플랫폼별 또는 기본 URL 사용)
    const dashboardUrl = getPlatformEnvOrDefault(this.platform, 'DASHBOARD_URL', '') || 
      `https://sentry.io/organizations/${orgSlug}/projects/`
    
    // 이슈 필터 URL
    const environment = getPlatformEnvOrDefault(this.platform, 'SENTRY_ENVIRONMENT', 'production')
    const query = [
      'level:[error,fatal]',
      `release:${releaseVersion}`,
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
}

// 플랫폼별 서비스 인스턴스 생성 함수
export function createSentryService(platform: Platform): SentryService {
  return new SentryService(platform)
}

// 기본 인스턴스 (Android)
export const sentryService = new SentryService('android')
