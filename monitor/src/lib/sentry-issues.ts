import { getRequiredEnv, getRequiredPlatformEnv } from './utils'
import { createSentryService } from './sentry'

export interface SentryEventDetails {
  id: string
  title?: string
  exceptionValues?: any[]
  stacktraceFrames?: any[]
  breadcrumbs?: any[]
}

async function sentryFetch(path: string, params?: Record<string, any>) {
  const token = getRequiredEnv('SENTRY_AUTH_TOKEN')
  const org = getRequiredEnv('SENTRY_ORG_SLUG')
  const base = 'https://sentry.io/api/0'
  const url = new URL(`${base}${path.replace('{org}', org)}`)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)))
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`Sentry API ${res.status}: ${await res.text()}`)
  return res.json()
}

function isNumericId(id: string): boolean {
  return /^[0-9]+$/.test(id)
}

async function resolveNumericIssueId(shortId: string): Promise<string | null> {
  // Search issues by short id: query=issue:ABC-123
  try {
    const res = await sentryFetch(`/organizations/{org}/issues/`, { query: `issue:${shortId}`, limit: 1 })
    const list = Array.isArray(res) ? res : []
    if (list.length > 0 && list[0]?.id) {
      return String(list[0].id)
    }
    return null
  } catch (e) {
    return null
  }
}

export async function getLatestEventIdForIssue(issueIdOrShort: string, platform: 'android'|'ios'): Promise<string | null> {
  // 프로젝트 한정 검색(조직 내 프로젝트가 여러 개일 때 이슈가 섞이지 않도록)
  let projectId: string | null = null
  try {
    const svc = createSentryService(platform)
    projectId = await svc.resolveProjectId()
    console.log(`[SentryIssues] platform=${platform} resolved projectId=${projectId}`)
  } catch (e) {
    console.warn('[SentryIssues] resolveProjectId failed:', e)
  }

  // 1) numeric issue id 경로 우선 시도
  if (isNumericId(issueIdOrShort)) {
    try {
      console.log('[SentryIssues] try numeric issue id path')
      const data = await sentryFetch(`/issues/${issueIdOrShort}/events/`, { per_page: 1, ...(projectId ? { project: projectId } : {}) })
      const arr = Array.isArray(data) ? data : []
      if (arr.length > 0) return arr[0]?.id || null
    } catch (e) {
      console.warn('[SentryIssues] numeric path failed:', e)
    }
  }

  // 2) 숏아이디 → numeric id 해석 후 재시도
  try {
    const resolved = await resolveNumericIssueId(issueIdOrShort)
    if (resolved) {
      try {
        console.log(`[SentryIssues] resolved shortId to numeric: ${resolved}`)
        const data = await sentryFetch(`/issues/${resolved}/events/`, { per_page: 1, ...(projectId ? { project: projectId } : {}) })
        const arr = Array.isArray(data) ? data : []
        if (arr.length > 0) return arr[0]?.id || null
      } catch (e) {
        console.warn('[SentryIssues] numeric events path failed:', e)
      }
    }
  } catch (e) {
    console.warn('[SentryIssues] resolve shortId failed:', e)
  }

  // 3) 마지막 폴백: events 검색 API에서 issue: 필터로 최신 이벤트 조회
  try {
    console.log('[SentryIssues] fallback events search path')
    const data = await sentryFetch(`/organizations/{org}/events/`, { query: `issue:${issueIdOrShort}`, per_page: 1, orderby: '-timestamp', field: 'id', ...(projectId ? { project: projectId } : {}) })
    const arr = Array.isArray(data?.data) ? data.data : []
    if (arr.length > 0) {
      // events explorer는 id가 data[row]['id']에 있을 수 있음
      const row = arr[0]
      const id = row?.id || row?.['id']
      if (id) return id
    }
  } catch (e) {
    console.warn('[SentryIssues] fallback events search failed:', e)
  }

  return null
}

export async function getEventDetails(eventId: string, platform?: 'android'|'ios'): Promise<SentryEventDetails> {
  let params: Record<string, any> | undefined
  let projectSlug: string | null = null
  if (platform) {
    try {
      const svc = createSentryService(platform)
      const projectId = await svc.resolveProjectId()
      params = { project: projectId }
      projectSlug = getRequiredPlatformEnv(platform, 'PROJECT_SLUG')
      console.log(`[SentryIssues] getEventDetails: scope projectId=${projectId}, slug=${projectSlug}`)
    } catch (e) {
      console.warn('[SentryIssues] getEventDetails: resolveProjectId/slug failed, proceeding without project param')
    }
  }
  // 1) org-level endpoint
  try {
    const data = await sentryFetch(`/organizations/{org}/events/${eventId}/`, params)
    const exceptions = data?.exception?.values || []
    const frames = exceptions?.[0]?.stacktrace?.frames || []
    const breadcrumbs = data?.breadcrumbs || []
    return {
      id: data?.id,
      title: data?.title || data?.message,
      exceptionValues: exceptions,
      stacktraceFrames: frames,
      breadcrumbs
    }
  } catch (e) {
    console.warn('[SentryIssues] org-level event fetch failed, trying project-level:', e)
  }
  // 2) project-level endpoint with slug
  if (projectSlug) {
    try {
      const data = await sentryFetch(`/projects/{org}/${projectSlug}/events/${eventId}/`, undefined)
      const exceptions = data?.exception?.values || []
      const frames = exceptions?.[0]?.stacktrace?.frames || []
      const breadcrumbs = data?.breadcrumbs || []
      return {
        id: data?.id,
        title: data?.title || data?.message,
        exceptionValues: exceptions,
        stacktraceFrames: frames,
        breadcrumbs
      }
    } catch (e2) {
      console.warn('[SentryIssues] project-level event fetch failed:', e2)
    }
  }
  throw new Error('Failed to fetch event details from Sentry (both org and project endpoints)')
}
