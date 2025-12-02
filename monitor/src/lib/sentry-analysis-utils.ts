/**
 * Sentry Analysis 공통 유틸리티
 *
 * 여러 API에서 중복되던 로직을 통합한 파일입니다:
 * - 플랫폼 감지 (4곳 중복 → 1곳)
 * - DB 저장 로직 (3개 패턴 → 1개)
 * - 분석 결과 타입 통합
 */

import {createClient} from '@supabase/supabase-js'

// ============================================
// 타입 정의
// ============================================

export type Platform = 'ios' | 'android' | 'web' | 'backend' | 'other'

export type AnalysisSource = 'openai' | 'openai_detailed' | 'webhook' | 'monitor' | 'manual'

export interface SentryIssueData {
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
  culprit?: string
  stackTrace?: string
  breadcrumbs?: unknown[]
  tags?: Array<{ key: string; value: string }>
  context?: unknown
  latestEvent?: unknown
  platform?: Platform
}

// 기존 AIAnalysisResult 타입 (ai-analysis.ts 호환)
export interface AIAnalysisResult {
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  category: string
  rootCause: string
  detailedAnalysis: string
  solutions: {
    immediate: string[]
    longTerm: string[]
    codeExample?: string
    monitoring?: string[]
    prevention?: string[]
  }
  references?: string[]
  detailedEvidence?: {
    stackTrace: string
    breadcrumbs: string
    eventGrouping: string
    analysisReasoning: string
    referenceData: string[]
  }
}

// 기존 IssueAnalysis 타입 (sentry-issue-analyzer.ts 호환)
export interface IssueAnalysis {
  severity: 'high' | 'medium' | 'low'
  category: string
  rootCause: string
  solution: string
}

// DB 저장 옵션
export interface SaveAnalysisOptions {
  source: AnalysisSource
  isMonitored?: boolean
  autoAnalyzed?: boolean
}

// ============================================
// 플랫폼 감지 (통합된 단일 함수)
// ============================================

/**
 * Sentry 이슈 데이터에서 플랫폼을 감지합니다.
 *
 * 우선순위:
 * 1. 명시적으로 전달된 platform
 * 2. 프로젝트 슬러그에서 추론
 * 3. Sentry URL에서 추론
 * 4. 이슈 제목에서 추론
 * 5. 기본값: 'android'
 */
export function detectPlatform(
  issueData?: Partial<SentryIssueData>,
  projectSlug?: string,
  explicitPlatform?: Platform
): Platform {
  // 1. 명시적 플랫폼
  if (explicitPlatform) {
    return explicitPlatform
  }

  // 2. 프로젝트 슬러그에서 추론
  if (projectSlug) {
    const slug = projectSlug.toLowerCase()
    if (slug.includes('ios') || slug.includes('iphone') || slug.includes('ipad')) {
      return 'ios'
    }
    if (slug.includes('android')) {
      return 'android'
    }
    if (slug.includes('web') || slug.includes('webapp') || slug.includes('frontend')) {
      return 'web'
    }
    if (slug.includes('backend') || slug.includes('api') || slug.includes('server')) {
      return 'backend'
    }
  }

  // 3. Sentry URL에서 추론
  if (issueData?.sentryUrl) {
    const url = issueData.sentryUrl.toLowerCase()
    if (url.includes('finda-ios')) return 'ios'
    if (url.includes('finda-android')) return 'android'
    if (url.includes('finda-web')) return 'web'
    if (url.includes('finda-backend') || url.includes('finda-api')) return 'backend'
  }

  // 4. 이슈 제목에서 추론
  if (issueData?.title) {
    const title = issueData.title.toLowerCase()
    if (title.includes('swift') || title.includes('ios') || title.includes('uikit') || title.includes('cocoa')) {
      return 'ios'
    }
    if (title.includes('android') || title.includes('kotlin') || title.includes('java')) {
      return 'android'
    }
    if (title.includes('react') || title.includes('vue') || title.includes('angular') || title.includes('javascript')) {
      return 'web'
    }
    if (title.includes('node') || title.includes('express') || title.includes('fastify')) {
      return 'backend'
    }
  }

  // 5. 기본값
  return 'android'
}

// ============================================
// DB 저장 로직 (통합된 단일 함수)
// ============================================

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function getSupabaseClient() {
  return createClient(supabaseUrl, supabaseKey)
}

/**
 * 분석 결과를 DB에 저장합니다.
 *
 * @param issueData - Sentry 이슈 데이터
 * @param analysis - 분석 결과 (AIAnalysisResult 또는 IssueAnalysis)
 * @param options - 저장 옵션
 */
export async function saveAnalysisToDb(
  issueData: SentryIssueData,
  analysis: AIAnalysisResult | IssueAnalysis,
  options: SaveAnalysisOptions
): Promise<void> {
  const supabase = getSupabaseClient()

  // 분석 버전 결정
  const analysisVersion = getAnalysisVersion(options.source)

  try {
    const { error } = await supabase
      .from('sentry_issue_analyses')
      .upsert({
        issue_id: issueData.issueId,
        issue_short_id: issueData.shortId,
        sentry_url: issueData.sentryUrl,
        issue_title: issueData.title,
        issue_level: issueData.level,
        issue_status: issueData.status,
        event_count: issueData.eventCount,
        user_count: issueData.userCount,
        first_seen: issueData.firstSeen,
        last_seen: issueData.lastSeen,
        culprit: issueData.culprit,
        ai_analysis: analysis,
        analysis_version: analysisVersion,
        is_monitored: options.isMonitored ?? false,
        auto_analyzed: options.autoAnalyzed ?? false,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'issue_id'
      })

    if (error) {
      throw error
    }

    console.log(`[AnalysisDB] Saved analysis for issue: ${issueData.issueId} (version: ${analysisVersion})`)
  } catch (error) {
    console.error('[AnalysisDB] Failed to save analysis:', error)
    // 저장 실패해도 분석 결과는 반환할 수 있도록 throw하지 않음
  }
}

/**
 * 기존 분석 결과를 DB에서 조회합니다.
 */
export async function getExistingAnalysis(issueId: string): Promise<{
  issueInfo: SentryIssueData
  analysis: AIAnalysisResult | IssueAnalysis
} | null> {
  const supabase = getSupabaseClient()

  try {
    const { data, error } = await supabase
      .from('sentry_issue_analyses')
      .select('*')
      .eq('issue_id', issueId)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows found
        return null
      }
      throw error
    }

    return {
      issueInfo: {
        issueId: data.issue_id,
        shortId: data.issue_short_id,
        title: data.issue_title,
        level: data.issue_level,
        status: data.issue_status,
        eventCount: data.event_count,
        userCount: data.user_count,
        firstSeen: data.first_seen,
        lastSeen: data.last_seen,
        sentryUrl: data.sentry_url,
        culprit: data.culprit
      },
      analysis: data.ai_analysis
    }
  } catch (error) {
    console.error('[AnalysisDB] Failed to get existing analysis:', error)
    return null
  }
}

/**
 * 분석 소스에 따른 버전 문자열 반환
 */
function getAnalysisVersion(source: AnalysisSource): string {
  switch (source) {
    case 'openai':
      return 'v2_enhanced_manual'
    case 'openai_detailed':
      return 'v2_enhanced_manual_detailed'
    case 'webhook':
      return 'v2_enhanced_webhook'
    case 'monitor':
      return 'v2_enhanced_monitor'
    case 'manual':
      return 'v2_enhanced_manual_new'
    default:
      return 'v2_enhanced'
  }
}

// ============================================
// 분석 결과 변환 유틸리티
// ============================================

/**
 * IssueAnalysis를 AIAnalysisResult로 변환합니다 (하위 호환성)
 */
export function issueAnalysisToAIResult(analysis: IssueAnalysis): AIAnalysisResult {
  const severityMap: Record<string, 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'> = {
    'low': 'LOW',
    'medium': 'MEDIUM',
    'high': 'HIGH'
  }

  return {
    severity: severityMap[analysis.severity] || 'MEDIUM',
    category: analysis.category,
    rootCause: analysis.rootCause,
    detailedAnalysis: analysis.rootCause,
    solutions: {
      immediate: [analysis.solution],
      longTerm: []
    }
  }
}

/**
 * AIAnalysisResult를 IssueAnalysis로 변환합니다 (하위 호환성)
 */
export function aiResultToIssueAnalysis(analysis: AIAnalysisResult): IssueAnalysis {
  const severityMap: Record<string, 'high' | 'medium' | 'low'> = {
    'CRITICAL': 'high',
    'HIGH': 'high',
    'MEDIUM': 'medium',
    'LOW': 'low'
  }

  return {
    severity: severityMap[analysis.severity] || 'medium',
    category: analysis.category,
    rootCause: analysis.rootCause,
    solution: analysis.solutions.immediate.join('\n') +
      (analysis.solutions.longTerm.length > 0
        ? '\n\n장기 해결책:\n' + analysis.solutions.longTerm.join('\n')
        : '')
  }
}

// ============================================
// 이모지 유틸리티
// ============================================

export function getSeverityEmoji(severity: string): string {
  const s = severity.toLowerCase()
  if (s === 'critical' || s === 'high') return '🚨'
  if (s === 'medium') return '⚠️'
  if (s === 'low') return 'ℹ️'
  return '❓'
}

export function getLevelEmoji(level: string): string {
  switch (level.toLowerCase()) {
    case 'error': return '🔴'
    case 'fatal': return '💀'
    case 'warning': return '🟡'
    case 'info': return '🔵'
    case 'debug': return '🟢'
    default: return '⚪'
  }
}
