interface AIAnalysisResult {
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

interface SentryIssueData {
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
  stackTrace?: string
  breadcrumbs?: any[]
  tags?: Array<{ key: string; value: string }>
  context?: any
  latestEvent?: any
}

class AIAnalyzer {
  private apiKey: string

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || ''
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required')
    }
  }

  private buildAnalysisPrompt(issueData: SentryIssueData): string {
    const contextInfo = [
      `이슈 ID: ${issueData.shortId || issueData.issueId}`,
      `제목: ${issueData.title}`,
      `레벨: ${issueData.level}`,
      `발생 횟수: ${issueData.eventCount}회`,
      `영향받은 사용자: ${issueData.userCount}명`,
      `첫 발생: ${issueData.firstSeen}`,
      `마지막 발생: ${issueData.lastSeen}`
    ].join('\n')

    const stackTrace = issueData.stackTrace ? 
      `\n스택 트레이스:\n${issueData.stackTrace.substring(0, 2000)}` : 
      '\n스택 트레이스: 없음'

    const breadcrumbs = issueData.breadcrumbs && issueData.breadcrumbs.length > 0 ? 
      `\n브레드크럼:\n${JSON.stringify(issueData.breadcrumbs.slice(-5), null, 2)}` : 
      '\n브레드크럼: 없음'

    const tags = issueData.tags && issueData.tags.length > 0 ? 
      `\n태그:\n${issueData.tags.map(tag => `${tag.key}: ${tag.value}`).join('\n')}` : 
      '\n태그: 없음'

    const context = issueData.context ? 
      `\n컨텍스트:\n${JSON.stringify(issueData.context, null, 2).substring(0, 1000)}` : 
      '\n컨텍스트: 없음'

    return `당신은 모바일 앱 개발 전문가이자 Sentry 에러 분석 전문가입니다. 
핀다(Finda) 금융 앱의 Sentry 이슈를 분석하고 해결방안을 제시해주세요.

# 이슈 정보:
${contextInfo}
${stackTrace}
${breadcrumbs}
${tags}
${context}

# 분석 요청사항:
1. 심각도를 CRITICAL, HIGH, MEDIUM, LOW 중 하나로 판정
2. 에러 카테고리 분류 (예: 네트워크 에러, 메모리 이슈, UI 에러, 써드파티 SDK 에러 등)
3. 근본 원인 분석
4. 상세한 기술적 분석 (사용자에게 미치는 영향 포함)
5. 해결방안을 단계별로 제시:
   - 즉시 대응 방안
   - 근본적 해결 방안
   - 코드 예제 (가능한 경우)
   - 모니터링 개선 방안
   - 예방 조치

6. 상세 근거:
   - 스택 트레이스 분석
   - 브레드크럼 패턴 분석
   - 이벤트 그룹핑 기준
   - 분석 근거
   - 참고 데이터

# 응답 형식:
JSON 형태로 다음 구조에 맞춰 응답해주세요:

{
  "severity": "MEDIUM",
  "category": "카테고리명",
  "rootCause": "간단한 원인 요약",
  "detailedAnalysis": "상세한 분석 내용 (최소 3문단, 사용자 영향도 포함)",
  "solutions": {
    "immediate": ["즉시 대응 방안 1", "즉시 대응 방안 2"],
    "longTerm": ["근본적 해결 방안 1", "근본적 해결 방안 2"],
    "codeExample": "코드 예제 (선택사항)",
    "monitoring": ["모니터링 개선 방안"],
    "prevention": ["예방 조치"]
  },
  "references": ["참고 자료"],
  "detailedEvidence": {
    "stackTrace": "스택 트레이스 분석 결과",
    "breadcrumbs": "브레드크럼 패턴 분석",
    "eventGrouping": "이벤트 그룹핑 기준 설명",
    "analysisReasoning": "분석 근거 (번호별 정리)",
    "referenceData": ["참고한 데이터 목록"]
  }
}

JSON만 응답하고 다른 텍스트는 포함하지 마세요.`
  }

  async analyzeIssue(issueData: SentryIssueData): Promise<AIAnalysisResult> {
    const prompt = this.buildAnalysisPrompt(issueData)
    
    console.log('[AIAnalyzer] Sending request to OpenAI...')
    
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4-turbo-preview',
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.1,
          max_tokens: 4000
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[AIAnalyzer] OpenAI API error:', errorText)
        throw new Error(`OpenAI API request failed: ${response.status} - ${response.statusText}`)
      }

      const data = await response.json()
      const content = data.choices[0].message.content

      console.log('[AIAnalyzer] Received response from OpenAI')

      // JSON 파싱
      let analysisResult: AIAnalysisResult
      try {
        analysisResult = JSON.parse(content)
      } catch (parseError) {
        console.error('[AIAnalyzer] Failed to parse OpenAI response as JSON:', content)
        throw new Error('AI 응답을 파싱할 수 없습니다')
      }

      // 필수 필드 검증
      if (!analysisResult.severity || !analysisResult.category || !analysisResult.rootCause) {
        throw new Error('AI 응답에 필수 필드가 누락되었습니다')
      }

      return analysisResult

    } catch (error) {
      console.error('[AIAnalyzer] Analysis failed:', error)
      
      // 에러 발생 시 기본 분석 결과 반환
      return this.getFallbackAnalysis(issueData)
    }
  }

  private getFallbackAnalysis(issueData: SentryIssueData): AIAnalysisResult {
    const severity = this.determineFallbackSeverity(issueData)
    
    return {
      severity,
      category: '분석 필요',
      rootCause: '자동 분석에 실패했습니다. 수동 검토가 필요합니다.',
      detailedAnalysis: `이슈 "${issueData.title}"에 대한 자동 분석이 실패했습니다. 

발생 횟수: ${issueData.eventCount}회
영향받은 사용자: ${issueData.userCount}명
레벨: ${issueData.level}

수동으로 Sentry 대시보드에서 상세 정보를 확인하고 분석을 진행해주세요.`,
      solutions: {
        immediate: [
          'Sentry 대시보드에서 상세 로그 확인',
          '최근 배포나 변경사항 검토',
          '영향받은 사용자 수와 패턴 분석'
        ],
        longTerm: [
          '근본 원인 파악을 위한 추가 로깅 추가',
          '유사한 에러 방지를 위한 테스트 케이스 작성',
          '에러 모니터링 및 알림 설정 개선'
        ]
      },
      references: ['Sentry 공식 문서'],
      detailedEvidence: {
        stackTrace: '자동 분석 실패로 인한 수동 검토 필요',
        breadcrumbs: '자동 분석 실패로 인한 수동 검토 필요',
        eventGrouping: '자동 분석 실패로 인한 수동 검토 필요',
        analysisReasoning: '1. 자동 분석이 실패했습니다.\n2. 수동 검토가 필요합니다.',
        referenceData: ['Sentry 이벤트 메타데이터', '에러 로그']
      }
    }
  }

  private determineFallbackSeverity(issueData: SentryIssueData): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    const { eventCount, userCount, level } = issueData
    
    if (level === 'fatal' || level === 'error') {
      if (userCount > 1000 || eventCount > 10000) return 'CRITICAL'
      if (userCount > 100 || eventCount > 1000) return 'HIGH'
      return 'MEDIUM'
    }
    
    if (level === 'warning') {
      if (userCount > 500 || eventCount > 5000) return 'HIGH'
      if (userCount > 50 || eventCount > 500) return 'MEDIUM'
      return 'LOW'
    }
    
    return 'LOW'
  }
}

export async function performAIAnalysis(issueData: SentryIssueData): Promise<AIAnalysisResult> {
  const analyzer = new AIAnalyzer()
  return analyzer.analyzeIssue(issueData)
}

export default AIAnalyzer