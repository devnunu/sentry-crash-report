import {NextRequest, NextResponse} from 'next/server'
import {createApiError, createApiResponse, getErrorMessage} from '@/lib/utils'
import {fetchSentryIssueData, parseIssueInput} from '@/lib/sentry-api'
import {performAIAnalysis} from '@/lib/ai-analysis'
import {
    detectPlatform,
    getExistingAnalysis,
    type Platform,
    saveAnalysisToDb,
    type SentryIssueData
} from '@/lib/sentry-analysis-utils'
import {
    type DetailedAnalysis,
    generateDetailedAnalysis,
    type IssueAnalysis,
    type SentryIssueDetail
} from '@/lib/sentry-issue-analyzer'

interface AnalyzeRequest {
  input: string // 이슈 ID, Short ID, 또는 Sentry URL
  platform?: Platform // 명시적 플랫폼 지정 (선택)
  forceNewAnalysis?: boolean // 캐시 무시하고 새로 분석
  includeDetailedAnalysis?: boolean // 상세 분석 포함 (Stack Trace, Breadcrumbs 등)
}

interface AnalyzeResponse {
  issueInfo: SentryIssueData
  analysis: unknown
  detailedAnalysis?: DetailedAnalysis
  source: 'cache' | 'openai'
}

/**
 * POST /api/sentry/analyze
 *
 * Sentry 이슈를 AI로 분석합니다.
 *
 * Request Body:
 * - input: 이슈 ID, Short ID, 또는 Sentry URL (필수)
 * - platform: 'ios' | 'android' | 'web' | 'backend' (선택, 자동 감지)
 * - forceNewAnalysis: 캐시 무시하고 새로 분석 (선택, 기본 false)
 * - includeDetailedAnalysis: 상세 분석 포함 (선택, 기본 false)
 *
 * Response:
 * - issueInfo: Sentry 이슈 정보
 * - analysis: AI 분석 결과
 * - detailedAnalysis: 상세 분석 (includeDetailedAnalysis=true 시)
 * - source: 'cache' | 'openai'
 */
export async function POST(request: NextRequest) {
  try {
    const body: AnalyzeRequest = await request.json()

    if (!body.input?.trim()) {
      return NextResponse.json(
        createApiError('이슈 ID 또는 URL을 입력해주세요'),
        { status: 400 }
      )
    }

    console.log('[Analyze] Starting analysis:', body.input)

    // 1. 입력값 파싱
    const parsedInput = parseIssueInput(body.input)

    // 2. 캐시 확인 (forceNewAnalysis가 false인 경우)
    if (!body.forceNewAnalysis) {
      const cached = await getExistingAnalysis(parsedInput.issueId)
      if (cached) {
        console.log('[Analyze] Returning cached analysis for:', parsedInput.issueId)

        const response: AnalyzeResponse = {
          issueInfo: cached.issueInfo,
          analysis: cached.analysis,
          source: 'cache'
        }

        return NextResponse.json(createApiResponse(response))
      }
    } else {
      console.log('[Analyze] Force new analysis requested')
    }

    // 3. Sentry에서 이슈 정보 가져오기
    const issueData = await fetchSentryIssueData(parsedInput.issueId, parsedInput.shortId)

    // 4. 플랫폼 감지 (공통 함수 사용)
    const platform = detectPlatform(issueData, parsedInput.projectSlug, body.platform)
    console.log(`[Analyze] Platform: ${platform}`)

    // 5. AI 분석 수행
    console.log('[Analyze] Calling OpenAI API...')
    const analysis = await performAIAnalysis(issueData, platform)

    // 6. 상세 분석 (옵션)
    let detailedAnalysis: DetailedAnalysis | undefined
    if (body.includeDetailedAnalysis) {
      console.log('[Analyze] Generating detailed analysis...')

      // 기본 분석을 IssueAnalysis 형식으로 변환
      const basicAnalysis: IssueAnalysis = {
        severity: analysis.severity.toLowerCase() as 'high' | 'medium' | 'low',
        category: analysis.category,
        rootCause: analysis.rootCause,
        solution: analysis.solutions.immediate.join('\n')
      }

      const issueDetail: SentryIssueDetail = {
        id: issueData.issueId,
        shortId: issueData.shortId || '',
        title: issueData.title,
        level: issueData.level,
        status: issueData.status,
        count: issueData.eventCount,
        userCount: issueData.userCount,
        firstSeen: issueData.firstSeen,
        lastSeen: issueData.lastSeen,
        culprit: issueData.culprit,
        permalink: issueData.sentryUrl
      }

      detailedAnalysis = await generateDetailedAnalysis(
        parsedInput.issueId,
        basicAnalysis,
        issueDetail
      )
    }

    // 7. 결과 DB에 저장 (공통 함수 사용)
    await saveAnalysisToDb(issueData, analysis, {
      source: body.forceNewAnalysis ? 'manual' : 'openai',
      isMonitored: false
    })

    // 8. 결과 반환
    const response: AnalyzeResponse = {
      issueInfo: issueData,
      analysis,
      detailedAnalysis,
      source: 'openai'
    }

    console.log('[Analyze] Analysis complete')
    return NextResponse.json(createApiResponse(response))

  } catch (error) {
    console.error('[Analyze] Failed:', error)

    return NextResponse.json(
      createApiError(getErrorMessage(error)),
      { status: 500 }
    )
  }
}

/**
 * GET /api/sentry/analyze?issueId=xxx
 *
 * 이슈의 기존 분석 결과를 조회합니다.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const issueId = searchParams.get('issueId')

    if (!issueId) {
      return NextResponse.json(
        createApiError('issueId 파라미터가 필요합니다'),
        { status: 400 }
      )
    }

    const cached = await getExistingAnalysis(issueId)

    if (!cached) {
      return NextResponse.json(
        createApiError('분석 결과가 없습니다. POST 요청으로 분석을 수행해주세요.'),
        { status: 404 }
      )
    }

    return NextResponse.json(createApiResponse({
      ...cached,
      source: 'cache' as const
    }))

  } catch (error) {
    console.error('[Analyze] GET failed:', error)

    return NextResponse.json(
      createApiError(getErrorMessage(error)),
      { status: 500 }
    )
  }
}
