interface SentryConfig {
  token: string
  organizationSlug: string
  projectSlug: string
  baseUrl: string
}

interface SentryIssueResponse {
  id: string
  shortId: string
  title: string
  level: string
  status: string
  count: string
  userCount: number
  firstSeen: string
  lastSeen: string
  permalink: string
  metadata: {
    value?: string
    type?: string
    filename?: string
    function?: string
  }
  culprit?: string
  tags: Array<{
    key: string
    value: string
  }>
  annotations: string[]
  assignedTo?: {
    name: string
    email: string
  }
  hasSeen: boolean
  numComments: number
  shareId?: string
  stats?: {
    '24h': Array<[number, number]>
  }
}

interface SentryEventResponse {
  id: string
  eventID: string
  size: number
  title: string
  message: string
  type: string
  metadata: {
    value?: string
    type?: string
  }
  tags: Array<{
    key: string
    value: string
  }>
  dateCreated: string
  user?: {
    id: string
    email?: string
    username?: string
    name?: string
  }
  entries: Array<{
    type: string
    data: any
  }>
  context: {
    [key: string]: any
  }
  fingerprints: string[]
  groupID: string
  errors: Array<{
    type: string
    message: string
    data: any
  }>
}

class SentryAPI {
  private config: SentryConfig

  constructor() {
    this.config = {
      token: process.env.SENTRY_AUTH_TOKEN || '',
      organizationSlug: process.env.SENTRY_ORG_SLUG || 'finda-b2c',
      projectSlug: process.env.SENTRY_PROJECT_SLUG || '',
      baseUrl: process.env.SENTRY_BASE_URL || 'https://sentry.io/api/0'
    }

    if (!this.config.token) {
      throw new Error('SENTRY_AUTH_TOKEN environment variable is required')
    }
  }

  private async makeRequest<T>(endpoint: string): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`
    
    console.log(`[SentryAPI] Making request to: ${url}`)
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.config.token}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[SentryAPI] Request failed: ${response.status} - ${errorText}`)
      throw new Error(`Sentry API request failed: ${response.status} - ${response.statusText}`)
    }

    const data = await response.json()
    return data as T
  }

  async getIssue(issueId: string): Promise<SentryIssueResponse> {
    const endpoint = `/issues/${issueId}/`
    return this.makeRequest<SentryIssueResponse>(endpoint)
  }

  async getIssueEvents(issueId: string, limit: number = 5): Promise<SentryEventResponse[]> {
    const endpoint = `/issues/${issueId}/events/?limit=${limit}`
    return this.makeRequest<SentryEventResponse[]>(endpoint)
  }

  async getLatestEvent(issueId: string): Promise<SentryEventResponse> {
    const endpoint = `/issues/${issueId}/events/latest/`
    return this.makeRequest<SentryEventResponse>(endpoint)
  }

  // Short ID를 실제 Issue ID로 변환
  async resolveShortId(shortId: string): Promise<string> {
    try {
      // Short ID로 직접 조회 시도
      const issue = await this.makeRequest<SentryIssueResponse>(`/issues/${shortId}/`)
      return issue.id
    } catch (error) {
      // Short ID로 조회 실패 시, 프로젝트에서 검색
      const searchEndpoint = `/projects/${this.config.organizationSlug}/${this.config.projectSlug}/issues/?query=is:unresolved&shortIdLookup=1&query=${shortId}`
      const issues = await this.makeRequest<SentryIssueResponse[]>(searchEndpoint)
      
      if (issues.length === 0) {
        throw new Error(`Issue not found with short ID: ${shortId}`)
      }
      
      return issues[0].id
    }
  }
}

// Short ID를 숫자 ID로 변환하는 함수 (기존 로직 개선)
export function parseIssueInput(input: string): { issueId: string; shortId?: string; url?: string; projectSlug?: string } {
  const trimmed = input.trim()
  
  // URL 형식에서 프로젝트 정보 추출: https://finda-b2c.sentry.io/projects/finda-android/issues/4567891234/
  const urlWithProjectMatch = trimmed.match(/https?:\/\/[^\/]+\/projects\/([^\/]+)\/issues\/(\d+)\/?/)
  if (urlWithProjectMatch) {
    return {
      issueId: urlWithProjectMatch[2],
      url: trimmed,
      projectSlug: urlWithProjectMatch[1]
    }
  }
  
  // URL 형식: https://finda-b2c.sentry.io/issues/4567891234/
  const urlMatch = trimmed.match(/https?:\/\/[^\/]+\/issues\/(\d+)\/?/)
  if (urlMatch) {
    return {
      issueId: urlMatch[1],
      url: trimmed
    }
  }
  
  // 숫자만: 4567891234
  const numberMatch = trimmed.match(/^\d+$/)
  if (numberMatch) {
    return {
      issueId: trimmed
    }
  }
  
  // Short ID 형식에서 프로젝트 추정: FINDA-IOS-ABC, FINDA-ANDROID-ABC 
  const shortIdWithProjectMatch = trimmed.match(/^FINDA-(IOS|ANDROID|WEB|BACKEND)-([A-Z0-9]+)$/i)
  if (shortIdWithProjectMatch) {
    const projectType = shortIdWithProjectMatch[1].toLowerCase()
    return {
      issueId: '', // API에서 resolve 필요
      shortId: trimmed,
      projectSlug: `finda-${projectType}`
    }
  }
  
  // Short ID 형식: ABC 형태 (프로젝트 불명)
  const shortIdMatch = trimmed.match(/^[A-Z0-9]+$/i)
  if (shortIdMatch) {
    return {
      issueId: '', // API에서 resolve 필요
      shortId: trimmed
    }
  }
  
  throw new Error('지원하지 않는 이슈 ID 형식입니다. 지원 형식: FINDA-ANDROID-ABC, 4567891234, https://sentry.io/projects/finda-android/issues/4567891234/')
}

export async function fetchSentryIssueData(issueId: string, shortId?: string): Promise<{
  issueId: string
  shortId?: string
  title: string
  level: string
  status: string
  eventCount: number
  userCount: number
  firstSeen: string
  lastSeen: string
  sentryUrl: string
  stackTrace?: string
  breadcrumbs?: any[]
  tags?: Array<{ key: string; value: string }>
  context?: any
  latestEvent?: any
}> {
  const sentryAPI = new SentryAPI()
  
  let actualIssueId = issueId
  
  // Short ID인 경우 실제 ID로 변환
  if (shortId && !issueId) {
    actualIssueId = await sentryAPI.resolveShortId(shortId)
  }
  
  // 이슈 기본 정보 가져오기
  const issue = await sentryAPI.getIssue(actualIssueId)
  
  // 최신 이벤트 가져오기 (상세 정보용)
  let latestEvent: SentryEventResponse | null = null
  let stackTrace = ''
  let breadcrumbs: any[] = []
  let context: any = {}
  
  try {
    latestEvent = await sentryAPI.getLatestEvent(actualIssueId)
    
    // Stack trace 추출
    const stackTraceEntry = latestEvent.entries.find(entry => entry.type === 'exception' || entry.type === 'stacktrace')
    if (stackTraceEntry) {
      stackTrace = JSON.stringify(stackTraceEntry.data, null, 2)
    }
    
    // Breadcrumbs 추출
    const breadcrumbsEntry = latestEvent.entries.find(entry => entry.type === 'breadcrumbs')
    if (breadcrumbsEntry) {
      breadcrumbs = breadcrumbsEntry.data.values || []
    }
    
    context = latestEvent.context || {}
  } catch (error) {
    console.warn('[SentryAPI] Failed to fetch latest event:', error)
  }
  
  return {
    issueId: actualIssueId,
    shortId: issue.shortId || shortId,
    title: issue.title,
    level: issue.level,
    status: issue.status,
    eventCount: parseInt(issue.count) || 0,
    userCount: issue.userCount || 0,
    firstSeen: issue.firstSeen,
    lastSeen: issue.lastSeen,
    sentryUrl: issue.permalink || `https://sentry.io/issues/${actualIssueId}/`,
    stackTrace,
    breadcrumbs,
    tags: issue.tags,
    context,
    latestEvent
  }
}

export default SentryAPI