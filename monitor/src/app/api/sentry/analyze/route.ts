import { NextRequest, NextResponse } from 'next/server'
import { createApiResponse, createApiError, getErrorMessage } from '@/lib/utils'
import { parseIssueInput, fetchSentryIssueData } from '@/lib/sentry-api'
import { performAIAnalysis } from '@/lib/ai-analysis'
import { createClient } from '@supabase/supabase-js'

interface SentryIssueInput {
  input: string // 사용자 입력 (다양한 형식)
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)




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

// DB에 분석 결과 저장
async function saveAnalysisResult(issueData: any, analysis: any) {
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
        ai_analysis: analysis,
        analysis_version: 'v1',
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'issue_id'
      })
    
    if (error) {
      throw error
    }
    
    console.log('[DB] Analysis saved successfully for issue:', issueData.issueId)
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
    
    // 2. 기존 분석 결과 확인
    const existingAnalysis = await getExistingAnalysis(parsedInput.issueId)
    if (existingAnalysis) {
      console.log('[API] Returning cached analysis for issue:', parsedInput.issueId)
      return NextResponse.json(createApiResponse(existingAnalysis))
    }
    
    // 3. Sentry에서 이슈 정보 가져오기
    const issueData = await fetchSentryIssueData(parsedInput.issueId, parsedInput.shortId)
    
    // 4. AI 분석 수행
    const analysis = await performAIAnalysis(issueData)
    
    // 5. 결과 DB에 저장
    await saveAnalysisResult(issueData, analysis)
    
    // 6. 결과 반환
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