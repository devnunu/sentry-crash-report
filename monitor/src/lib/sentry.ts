import { getRequiredEnv } from './utils'
import type { WindowAggregation, TopIssue } from './types'

// Sentry API 설정
const SENTRY_API_BASE = 'https://sentry.io/api/0'
const SENTRY_ENVIRONMENT = process.env.SENTRY_ENVIRONMENT || 'production'

// Sentry API 응답 타입들
interface SentryRelease {
  version: string
  shortVersion?: string
  dateReleased?: string
  dateCreated: string
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

interface SentryProject {
  id: string
  slug: string
}

export class SentryService {
  private projectId: string | null = null
  
  constructor() {
    // 환경 변수 검증은 실제 호출 시에 수행
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
    const projectSlug = getRequiredEnv('SENTRY_PROJECT_SLUG')
    
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
      .map(r => r.version || r.shortVersion || '')
      .filter(Boolean)
    
    if (candidates.length === 0) {
      return null
    }
    
    // 빌드 번호로 정렬 (높은 번호가 최신)
    const sortedCandidates = candidates.sort((a, b) => {
      const getBuildNumber = (version: string): number => {
        const plusIndex = version.indexOf('+')
        if (plusIndex === -1) return 0
        
        try {
          return parseInt(version.substring(plusIndex + 1))
        } catch {
          return 0
        }
      }
      
      return getBuildNumber(b) - getBuildNumber(a)
    })
    
    return sortedCandidates[0]
  }
  
  // 릴리즈 생성/배포 시간 조회
  async getReleaseCreatedAt(version: string): Promise<Date | null> {
    const orgSlug = getRequiredEnv('SENTRY_ORG_SLUG')
    const projectId = await this.resolveProjectId()
    
    try {
      const release = await this.fetchSentryAPI<SentryRelease>(
        `/organizations/${orgSlug}/releases/${encodeURIComponent(version)}/`,
        { project: projectId }
      )
      
      const timestamp = release.dateReleased || release.dateCreated
      return timestamp ? new Date(timestamp) : null
    } catch {
      return null
    }
  }
  
  // 윈도우 집계 데이터 조회
  async getWindowAggregates(
    releaseVersion: string,
    startTime: Date,
    endTime: Date
  ): Promise<WindowAggregation> {
    const orgSlug = getRequiredEnv('SENTRY_ORG_SLUG')
    const projectId = await this.resolveProjectId()
    
    const query = [
      'level:[error,fatal]',
      `release:${releaseVersion}`,
      SENTRY_ENVIRONMENT ? `environment:${SENTRY_ENVIRONMENT}` : ''
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
    
    const query = [
      'level:[error,fatal]',
      `release:${releaseVersion}`,
      SENTRY_ENVIRONMENT ? `environment:${SENTRY_ENVIRONMENT}` : ''
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
    
    // 대시보드 URL (커스텀 URL이 있으면 사용)
    const dashboardUrl = process.env.SENTRY_DASHBOARD_URL || 
      `https://sentry.io/organizations/${orgSlug}/projects/`
    
    // 이슈 필터 URL
    const query = [
      'level:[error,fatal]',
      `release:${releaseVersion}`,
      SENTRY_ENVIRONMENT ? `environment:${SENTRY_ENVIRONMENT}` : ''
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

// 싱글톤 인스턴스
export const sentryService = new SentryService()