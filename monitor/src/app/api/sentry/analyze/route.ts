import { NextRequest, NextResponse } from 'next/server'
import { createApiResponse, createApiError, getErrorMessage } from '@/lib/utils'
import { parseIssueInput, fetchSentryIssueData } from '@/lib/sentry-api'
import { performAIAnalysis, type Platform } from '@/lib/ai-analysis'
import { createClient } from '@supabase/supabase-js'

interface SentryIssueInput {
  input: string // 사용자 입력 (다양한 형식)
  forceNewAnalysis?: boolean // 새로 분석 강제 실행 옵션
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

// 프로젝트 슬러그나 이슈 정보에서 플랫폼 추정
function detectPlatformFromIssueData(issueData: any, projectSlug?: string): Platform {
  // 1. 프로젝트 슬러그에서 플랫폼 추정
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

  // 2. 이슈 데이터에서 플랫폼 추정
  if (issueData?.sentryUrl) {
    const url = issueData.sentryUrl.toLowerCase()
    if (url.includes('finda-ios')) return 'ios'
    if (url.includes('finda-android')) return 'android'
    if (url.includes('finda-web')) return 'web'
    if (url.includes('finda-backend') || url.includes('finda-api')) return 'backend'
  }

  // 3. 이슈 제목에서 플랫폼 추정
  if (issueData?.title) {
    const title = issueData.title.toLowerCase()
    if (title.includes('android') || title.includes('kotlin') || title.includes('java')) {
      return 'android'
    }
    if (title.includes('ios') || title.includes('swift')) {
      return 'ios'
    }
  }

  // 4. 기본값은 Android (에러 메시지가 Java/Gson 관련이므로)
  return 'android'
}



// DB에서 기존 분석 결과 조회
async function getExistingAnalysis(issueId: string) {
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
        sentryUrl: data.sentry_url
      },
      analysis: data.ai_analysis
    }
  } catch (error) {
    console.error('[DB] Failed to get existing analysis:', error)
    return null
  }
}

// DB에 분석 결과 저장 (모니터링 API와 동일한 구조)
async function saveAnalysisResult(issueData: any, analysis: any, isNewAnalysis: boolean = false) {
  try {
    const analysisVersion = isNewAnalysis ? 'v2_enhanced_manual_new' : 'v2_enhanced_manual'
    
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
        analysis_version: analysisVersion,
        is_monitored: false, // 수동 분석임을 표시
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'issue_id'
      })
    
    if (error) {
      throw error
    }
    
    console.log(`[DB] Analysis saved successfully for issue: ${issueData.issueId} (${analysisVersion})`)
  } catch (error) {
    console.error('[DB] Failed to save analysis:', error)
    // Don't throw error - analysis can still be returned even if saving fails
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: SentryIssueInput = await request.json()
    
    if (!body.input?.trim()) {
      return NextResponse.json(
        createApiError('이슈 ID를 입력해주세요'),
        { status: 400 }
      )
    }
    
    console.log('[API] Analyzing Sentry issue:', body.input)
    
    // 1. 입력값 파싱
    const parsedInput = parseIssueInput(body.input)
    
    // 2. 기존 분석 결과 확인 (새로 분석 옵션이 false인 경우에만)
    if (!body.forceNewAnalysis) {
      const existingAnalysis = await getExistingAnalysis(parsedInput.issueId)
      if (existingAnalysis) {
        console.log('[API] Returning cached analysis for issue:', parsedInput.issueId)
        return NextResponse.json(createApiResponse(existingAnalysis))
      }
    } else {
      console.log('[API] Force new analysis requested for issue:', parsedInput.issueId)
    }
    
    // 3. Sentry에서 이슈 정보 가져오기
    const issueData = await fetchSentryIssueData(parsedInput.issueId, parsedInput.shortId)
    
    // 4. 플랫폼 감지
    const detectedPlatform = detectPlatformFromIssueData(issueData, parsedInput.projectSlug)
    console.log(`[API] Detected platform: ${detectedPlatform} for issue: ${parsedInput.issueId}`)
    
    // 5. AI 분석 수행 (플랫폼 정보 포함)
    const analysis = await performAIAnalysis(issueData, detectedPlatform)
    
    // 6. 결과 DB에 저장
    await saveAnalysisResult(issueData, analysis, body.forceNewAnalysis || false)
    
    // 7. 결과 반환
    const result = {
      issueInfo: issueData,
      analysis
    }
    
    return NextResponse.json(createApiResponse(result))
    
  } catch (error) {
    console.error('[API] Failed to analyze Sentry issue:', error)
    
    return NextResponse.json(
      createApiError(getErrorMessage(error)),
      { status: 500 }
    )
  }
}