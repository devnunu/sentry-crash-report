import { z } from 'zod'

// 플랫폼 타입
export type Platform = 'android' | 'ios'

// 모니터링 상태
export type MonitorStatus = 'active' | 'stopped' | 'expired'

// 데이터베이스 스키마 타입
export interface MonitorSession {
  id: string
  platform: Platform
  base_release: string
  matched_release?: string
  status: MonitorStatus
  started_at: string
  expires_at: string
  created_at: string
  updated_at: string
}

export interface MonitorHistory {
  id: string
  monitor_id: string
  executed_at: string
  window_start: string
  window_end: string
  events_count: number
  issues_count: number
  users_count: number
  top_issues: TopIssue[] // JSON 형태
  slack_sent: boolean
  created_at: string
}

// API 요청/응답 스키마
export const StartMonitorSchema = z.object({
  platform: z.enum(['android', 'ios']),
  baseRelease: z.string().min(1),
  days: z.number().min(1).max(14).optional().default(7)
})

export const StopMonitorSchema = z.object({
  monitorId: z.string().uuid()
})

export type StartMonitorRequest = z.infer<typeof StartMonitorSchema>
export type StopMonitorRequest = z.infer<typeof StopMonitorSchema>

// API 응답 타입
export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export interface StartMonitorResponse {
  monitorId: string
  message: string
}

export interface MonitorStatusResponse {
  monitors: MonitorSession[]
}

// Sentry API 관련 타입
export interface SentryIssue {
  id: string
  shortId: string
  title: string
  level: string
  status: string
  count: number
  userCount: number
  permalink: string
}

export interface WindowAggregation {
  events: number
  issues: number
  users: number
}

export interface TopIssue {
  issueId: string
  shortId: string
  title: string
  events: number
  users: number
  link: string
}