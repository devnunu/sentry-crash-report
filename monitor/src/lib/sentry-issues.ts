import { getRequiredEnv } from './utils'

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

export async function getLatestEventIdForIssue(issueId: string): Promise<string | null> {
  const data = await sentryFetch(`/issues/${issueId}/events/`, { per_page: 1 })
  const arr = Array.isArray(data) ? data : []
  if (arr.length === 0) return null
  return arr[0]?.id || null
}

export async function getEventDetails(eventId: string): Promise<SentryEventDetails> {
  const data = await sentryFetch(`/organizations/{org}/events/${eventId}/`)
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
}

