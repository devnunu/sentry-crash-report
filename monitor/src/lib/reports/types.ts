import { z } from 'zod'

// 리포트 실행 기록 타입
export interface ReportExecution {
  id: string
  report_type: 'daily' | 'weekly'
  status: 'success' | 'error' | 'running'
  trigger_type: 'scheduled' | 'manual'
  target_date: string
  start_date: string
  end_date: string
  result_data?: unknown
  ai_analysis?: unknown
  slack_sent: boolean
  error_message?: string
  execution_time_ms?: number
  execution_logs?: string[]
  created_at: string
}

// 요일 타입 정의
export type WeekDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

// 리포트 설정 타입
export interface ReportSettings {
  id: string
  report_type: 'daily' | 'weekly'
  auto_enabled: boolean
  schedule_time: string
  schedule_days: WeekDay[]
  ai_enabled: boolean
  created_at: string
  updated_at: string
}

// 일간 리포트 데이터 타입 (Python과 동일한 구조)
export interface DailyReportData {
  timezone: string
  [date: string]: {
    crash_events: number
    unique_issues: number
    impacted_users: number
    issues_count: number
    unique_issues_in_events: number
    crash_free_sessions_pct?: number
    crash_free_users_pct?: number
    top_5_issues: TopIssue[]
    new_issues: NewIssue[]
    surge_issues: SurgeIssue[]
    window_utc: {
      start: string
      end: string
    }
  } | string
}

// 주간 리포트 데이터 타입
export interface WeeklyReportData {
  this_week_range_kst: string
  prev_week_range_kst: string
  this_week: {
    events: number
    issues: number
    users: number
    crash_free_sessions?: number
    crash_free_users?: number
  }
  prev_week: {
    events: number
    issues: number
    users: number
  }
  top5_events: WeeklyIssue[]
  prev_top_events: WeeklyIssue[]
  new_issues: NewIssue[]
  surge_issues: WeeklySurgeIssue[]
  this_week_release_fixes: ReleaseFix[]
}

// 공통 이슈 타입
export interface TopIssue {
  issue_id: string
  title: string
  event_count: number
  link?: string
}

export interface NewIssue {
  issue_id: string
  title: string
  event_count?: number | null
  first_seen?: string
  link?: string
}

export interface SurgeIssue {
  issue_id: string
  title: string
  event_count: number
  link?: string
  dby_count?: number
  growth_multiplier?: number
  zscore?: number
  mad_score?: number
  baseline_mean?: number
  baseline_std?: number
  baseline_median?: number
  baseline_mad?: number
  baseline_counts?: number[]
  reasons: string[]
}

export interface WeeklyIssue {
  issue_id: string
  short_id: string
  title: string
  events: number
  users: number
  link?: string
}

export interface WeeklySurgeIssue {
  issue_id: string
  title: string
  event_count: number
  prev_count: number
  growth_multiplier: number
  zscore?: number
  mad_score?: number
  link?: string
  reasons: string[]
}

export interface ReleaseFix {
  release: string
  disappeared: ReleaseFixIssue[]
  decreased: ReleaseFixIssue[]
}

export interface ReleaseFixIssue {
  issue_id: string
  title: string
  pre_7d_events: number
  post_7d_events: number
  delta_pct?: number
  link?: string
}

// AI 분석 결과 타입 (Python과 동일)
export interface AIAnalysis {
  newsletter_summary: string
  today_actions: AIAction[]
  root_cause: string[]
  per_issue_notes: AIIssueNote[]
  fallback_text?: string // Python의 fallback 형태
}

export interface AIAction {
  title: string
  why: string
  owner_role: string
  suggestion: string
}

export interface AIIssueNote {
  issue_title: string
  note: string
}

// API 요청 스키마
export const GenerateDailyReportSchema = z.object({
  targetDate: z.string().optional(),
  sendSlack: z.boolean().default(true),
  includeAI: z.boolean().default(true)
})

export const GenerateWeeklyReportSchema = z.object({
  targetWeek: z.string().optional(), // 'YYYY-MM-DD' format (월요일)
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  sendSlack: z.boolean().default(true),
  includeAI: z.boolean().default(true)
})

export const UpdateReportSettingsSchema = z.object({
  auto_enabled: z.boolean().optional(),
  schedule_time: z.string().optional(),
  schedule_days: z.array(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])).optional(),
  ai_enabled: z.boolean().optional()
})

export type GenerateDailyReportRequest = z.infer<typeof GenerateDailyReportSchema>
export type GenerateWeeklyReportRequest = z.infer<typeof GenerateWeeklyReportSchema>
export type UpdateReportSettingsRequest = z.infer<typeof UpdateReportSettingsSchema>

// API 응답 타입
export interface GenerateReportResponse {
  executionId: string
  message: string
}

export interface ReportHistoryResponse {
  reports: ReportExecution[]
  total: number
}

export interface ReportSettingsResponse {
  settings: ReportSettings
}