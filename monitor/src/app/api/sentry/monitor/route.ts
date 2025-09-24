import { NextRequest, NextResponse } from 'next/server'
import { createApiResponse, createApiError, getErrorMessage } from '@/lib/utils'
import { fetchSentryIssueData } from '@/lib/sentry-api'
import { performAIAnalysis, type Platform } from '@/lib/ai-analysis'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

// 프로젝트 슬러그에서 플랫폼 추정
function detectPlatformFromProject(projectSlug: string): Platform {
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
  return 'other'
}

interface SentryIssue {
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
  project: {
    id: string
    name: string
    slug: string
  }
}

interface MonitoringConfig {
  enabled: boolean
  projectSlugs: string[]
  minLevel: string
  autoAnalyze: boolean
  maxIssuesPerCheck: number
  checkIntervalMinutes: number
}

// 최근 이슈 조회 (5분 이내)
async function getRecentSentryIssues(projectSlug: string = 'finda-ios'): Promise<SentryIssue[]> {
  const token = process.env.SENTRY_AUTH_TOKEN
  const orgSlug = process.env.SENTRY_ORG_SLUG || 'finda-b2c'
  const baseUrl = process.env.SENTRY_BASE_URL || 'https://sentry.io/api/0'
  
  if (!token) {
    throw new Error('SENTRY_AUTH_TOKEN environment variable is required')
  }
  
  // 5분 전 시간
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  
  const url = `${baseUrl}/projects/${orgSlug}/${projectSlug}/issues/?statsPeriod=1h&query=is:unresolved level:error level:fatal&sort=date`
  
  console.log(`[Monitor] Fetching recent issues from: ${url}`)
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  })
  
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Sentry API request failed: ${response.status} - ${errorText}`)
  }
  
  const issues: SentryIssue[] = await response.json()
  
  // 최근 5분 이내에 발생한 이슈만 필터링
  const recentIssues = issues.filter(issue => {
    const lastSeen = new Date(issue.lastSeen)
    return lastSeen > new Date(fiveMinutesAgo)
  })
  
  console.log(`[Monitor] Found ${issues.length} total issues, ${recentIssues.length} recent issues`)
  
  return recentIssues.slice(0, 10) // 최대 10개만 처리
}

// 이미 분석된 이슈인지 확인
async function isIssueAlreadyAnalyzed(issueId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('sentry_issue_analyses')
      .select('issue_id')
      .eq('issue_id', issueId)
      .single()
    
    if (error && error.code !== 'PGRST116') {
      console.warn('[Monitor] Error checking existing analysis:', error)
    }
    
    return !!data
  } catch (error) {
    console.warn('[Monitor] Failed to check existing analysis:', error)
    return false
  }
}

// 모니터링 설정 조회
async function getMonitoringConfig(): Promise<MonitoringConfig> {
  try {
    const { data, error } = await supabase
      .from('monitoring_config')
      .select('*')
      .single()
    
    if (error) {
      // 기본 설정 반환 (다중 플랫폼 지원)
      return {
        enabled: true,
        projectSlugs: ['finda-ios', 'finda-android'],
        minLevel: 'error',
        autoAnalyze: true,
        maxIssuesPerCheck: 5,
        checkIntervalMinutes: 5
      }
    }
    
    return {
      enabled: data.enabled,
      projectSlugs: data.project_slugs || ['finda-ios', 'finda-android'],
      minLevel: data.min_level || 'error',
      autoAnalyze: data.auto_analyze,
      maxIssuesPerCheck: data.max_issues_per_check || 5,
      checkIntervalMinutes: data.check_interval_minutes || 5
    }
  } catch (error) {
    console.warn('[Monitor] Failed to get monitoring config, using defaults:', error)
    return {
      enabled: true,
      projectSlugs: ['finda-ios', 'finda-android'],
      minLevel: 'error',
      autoAnalyze: true,
      maxIssuesPerCheck: 5,
      checkIntervalMinutes: 5
    }
  }
}

// 이슈 분석 및 저장
async function analyzeAndSaveIssue(issue: SentryIssue, projectSlug: string) {
  try {
    console.log(`[Monitor] Analyzing ${projectSlug} issue: ${issue.shortId || issue.id}`)
    
    // Sentry에서 상세 데이터 가져오기
    const issueData = await fetchSentryIssueData(issue.id, issue.shortId)
    
    // 프로젝트 슬러그에서 플랫폼 감지
    const detectedPlatform = detectPlatformFromProject(projectSlug)
    
    // AI 분석 수행 (플랫폼 정보 포함)
    const analysis = await performAIAnalysis(issueData, detectedPlatform)
    
    // DB에 저장
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
        ai_analysis: analysis,
        analysis_version: 'v2_enhanced',
        is_monitored: true,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'issue_id'
      })
    
    if (error) {
      throw error
    }
    
    console.log(`[Monitor] Successfully analyzed and saved issue: ${issue.shortId || issue.id}`)
    
    return {
      issueId: issueData.issueId,
      shortId: issueData.shortId,
      title: issueData.title,
      severity: analysis.severity,
      category: analysis.category,
      analyzed: true
    }
  } catch (error) {
    console.error(`[Monitor] Failed to analyze issue ${issue.shortId || issue.id}:`, error)
    return {
      issueId: issue.id,
      shortId: issue.shortId,
      title: issue.title,
      severity: 'UNKNOWN',
      category: 'Analysis Failed',
      analyzed: false,
      error: getErrorMessage(error)
    }
  }
}

// 모니터링 실행 로그 저장
async function saveMonitoringLog(results: any[]) {
  try {
    const { error } = await supabase
      .from('monitoring_logs')
      .insert({
        check_time: new Date().toISOString(),
        issues_found: results.length,
        issues_analyzed: results.filter(r => r.analyzed).length,
        results: results,
        status: 'completed'
      })
    
    if (error) {
      console.error('[Monitor] Failed to save monitoring log:', error)
    }
  } catch (error) {
    console.error('[Monitor] Failed to save monitoring log:', error)
  }
}

// GET: 모니터링 상태 조회
export async function GET(request: NextRequest) {
  try {
    const config = await getMonitoringConfig()
    
    // 최근 모니터링 로그 조회
    const { data: recentLogs } = await supabase
      .from('monitoring_logs')
      .select('*')
      .order('check_time', { ascending: false })
      .limit(5)
    
    // 분석된 이슈 통계
    const { data: analysisStats } = await supabase
      .from('sentry_issue_analyses')
      .select('analysis_version, is_monitored, created_at')
      .eq('is_monitored', true)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // 최근 24시간
    
    const stats = {
      totalAnalyzed: analysisStats?.length || 0,
      enhancedAnalyses: analysisStats?.filter(a => a.analysis_version === 'v2_enhanced').length || 0,
      recentChecks: recentLogs?.length || 0
    }
    
    return NextResponse.json(createApiResponse({
      config,
      stats,
      recentLogs: recentLogs || [],
      lastCheck: recentLogs?.[0]?.check_time || null
    }))
  } catch (error) {
    console.error('[Monitor] Failed to get monitoring status:', error)
    return NextResponse.json(
      createApiError(getErrorMessage(error)),
      { status: 500 }
    )
  }
}

// POST: 모니터링 수동 실행
export async function POST(request: NextRequest) {
  try {
    console.log('[Monitor] Starting manual monitoring check...')
    
    const config = await getMonitoringConfig()
    
    if (!config.enabled) {
      return NextResponse.json(
        createApiError('Monitoring is disabled'),
        { status: 400 }
      )
    }
    
    const results = []
    
    for (const projectSlug of config.projectSlugs) {
      console.log(`[Monitor] Checking project: ${projectSlug}`)
      
      try {
        // 최근 이슈 조회
        const recentIssues = await getRecentSentryIssues(projectSlug)
        
        if (recentIssues.length === 0) {
          console.log(`[Monitor] No recent issues found for project: ${projectSlug}`)
          continue
        }
        
        // 설정된 최대 개수만큼 처리
        const issuesToProcess = recentIssues.slice(0, config.maxIssuesPerCheck)
        
        for (const issue of issuesToProcess) {
          // 이미 분석된 이슈인지 확인
          const alreadyAnalyzed = await isIssueAlreadyAnalyzed(issue.id)
          
          if (alreadyAnalyzed) {
            console.log(`[Monitor] Issue ${issue.shortId || issue.id} already analyzed, skipping`)
            results.push({
              issueId: issue.id,
              shortId: issue.shortId,
              title: issue.title,
              analyzed: false,
              reason: 'Already analyzed'
            })
            continue
          }
          
          // 자동 분석이 활성화된 경우에만 분석 수행
          if (config.autoAnalyze) {
            const result = await analyzeAndSaveIssue(issue, projectSlug)
            results.push(result)
          } else {
            results.push({
              issueId: issue.id,
              shortId: issue.shortId,
              title: issue.title,
              analyzed: false,
              reason: 'Auto-analyze disabled'
            })
          }
        }
        
      } catch (error) {
        console.error(`[Monitor] Failed to check project ${projectSlug}:`, error)
        results.push({
          project: projectSlug,
          error: getErrorMessage(error),
          analyzed: false
        })
      }
    }
    
    // 모니터링 로그 저장
    await saveMonitoringLog(results)
    
    console.log(`[Monitor] Monitoring check completed. Processed ${results.length} issues`)
    
    return NextResponse.json(createApiResponse({
      message: 'Monitoring check completed',
      processed: results.length,
      analyzed: results.filter(r => r.analyzed).length,
      results
    }))
    
  } catch (error) {
    console.error('[Monitor] Monitoring check failed:', error)
    
    return NextResponse.json(
      createApiError(getErrorMessage(error)),
      { status: 500 }
    )
  }
}