import {z} from 'zod'
import type {Platform} from '../types'

// 리포트 실행 기록 타입
export interface ReportExecution {
  id: string
  report_type: 'daily'
  status: 'success' | 'error' | 'running'
  trigger_type: 'scheduled' | 'manual'
  platform?: Platform
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
  report_type: 'daily'
  auto_enabled: boolean
  schedule_time: string
  schedule_days: WeekDay[]
  slack_days?: WeekDay[]
  ai_enabled: boolean
  is_test_mode?: boolean
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
    // 해당 일자에 발생한 이슈 전체 목록 (이벤트/사용자 기준)
    issues?: WeeklyIssue[]
    // 기존 Top 5 (이전 호환성 유지 목적)
    top_5_issues?: TopIssue[]
    new_issues: NewIssue[]
    surge_issues: SurgeIssue[]
    window_utc: {
      start: string
      end: string
    }
  } | string
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

// AI 분석 결과 타입 (개선된 버전)
export interface AIAnalysis {
  // 새로운 구조
  status_summary?: {
    level: 'normal' | 'warning' | 'critical'
    headline: string
    detail: string
    full_analysis: {
      overview: string
      trend_analysis: string
      key_insights: string[]
      recommendations: string
    }
  }
  today_actions: AIAction[]
  important_issue_analysis?: AIImportantIssue[]

  // 하위 호환성을 위한 필드
  newsletter_summary?: string
  root_cause?: string[]
  per_issue_notes?: AIIssueNote[]
  full_analysis?: {
    overview: string
    trend_analysis: string
    key_insights: string[]
    recommendations: string
  }
  fallback_text?: string // fallback 형태
}

export interface AIAction {
  title: string
  why: string
  owner_role: string
  suggestion: string
  // 새로 추가된 필드
  priority?: 'high' | 'medium' | 'low'
  issue_id?: string
  estimated_time?: string
  impact?: string
}

export interface AIIssueNote {
  issue_title: string
  issue_id?: string
  note?: string  // 간단한 한 줄 코멘트 (fallback)
  analysis?: {   // 상세 분석
    root_cause?: string
    user_impact?: string
    fix_suggestion?: string
    code_location?: string
    similar_issues?: string
  }
}

export interface AIImportantIssue {
  issue_id: string
  issue_title: string
  analysis: {
    root_cause: string
    user_impact: string
    fix_suggestion: string
    code_location: string
    similar_issues?: string
  }
}

// API 요청 스키마
export const GenerateDailyReportSchema = z.object({
  targetDate: z.string().optional(),
  sendSlack: z.boolean().default(true),
  includeAI: z.boolean().default(true),
  isTestMode: z.boolean().optional().default(false),
  platform: z.enum(['android', 'ios', 'all']).optional().default('all')
})

export const UpdateReportSettingsSchema = z.object({
  auto_enabled: z.boolean().optional(),
  schedule_time: z.string().optional(),
  schedule_days: z.array(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])).optional(),
  slack_days: z.array(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])).optional(),
  ai_enabled: z.boolean().optional(),
  is_test_mode: z.boolean().optional()
})

export type GenerateDailyReportRequest = z.infer<typeof GenerateDailyReportSchema>
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
