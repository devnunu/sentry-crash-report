/**
 * Sentry Issue Analyzer
 *
 * OpenAI API를 사용하여 Sentry 이슈를 심층 분석합니다.
 * SentryMCP/Sources/SentryMCP/SentryMCPClient.swift의 analyzeIssue() 로직을 포팅했습니다.
 */

// 이슈 분석 결과 타입
export interface IssueAnalysis {
  severity: 'high' | 'medium' | 'low'
  category: string
  rootCause: string
  solution: string
}

// 상세 분석 결과 타입
export interface DetailedAnalysis {
  stackTraceAnalysis: string
  breadcrumbsAnalysis: string
  eventGroupingAnalysis: string
  evidenceReasoning: string
  referenceData: string
}

// Sentry 이슈 상세 정보 타입
export interface SentryIssueDetail {
  id: string
  shortId: string
  title: string
  level: string
  status: string
  count: number
  userCount: number
  firstSeen: string
  lastSeen: string
  culprit?: string
  permalink: string
  metadata?: {
    type?: string
    value?: string
    filename?: string
    function?: string
  }
  tags?: Array<{ key: string; value: string }>
}

// OpenAI API 호출
async function callOpenAI(
  systemMessage: string,
  userMessage: string,
  maxTokens: number = 4000
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY 환경변수가 설정되지 않았습니다')
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.3,
      max_tokens: maxTokens
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  return data.choices[0].message.content
}

/**
 * Sentry 이슈를 OpenAI API로 심층 분석합니다.
 *
 * @param issueDetails - Sentry 이슈 상세 정보 (문자열 또는 객체)
 * @param issueId - 이슈 ID
 * @param platform - 플랫폼 ('android' | 'ios')
 * @returns IssueAnalysis 분석 결과
 */
export async function analyzeIssue(
  issueDetails: string | SentryIssueDetail,
  issueId: string,
  platform: 'android' | 'ios' = 'android'
): Promise<IssueAnalysis> {
  console.log(`[IssueAnalyzer] OpenAI API를 통한 이슈 분석 시작: ${issueId}`)

  const issueDetailsString = typeof issueDetails === 'string'
    ? issueDetails
    : formatIssueDetails(issueDetails)

  const platformName = platform === 'ios' ? 'finda-ios' : 'finda-android'
  const platformDescription = platform === 'ios' ? 'iOS 앱' : 'Android 앱'

  const systemMessage = `당신은 ${platformDescription} 개발 전문가이며 핀테크 도메인 전문가입니다.
당신은 20년차 모바일 앱 개발 전문가이며 Sentry 에러 분석 전문가입니다.
Apple, Google, Meta 등 글로벌 테크 기업에서 대규모 모바일 앱을 개발하고 운영한 경험이 있습니다.

반드시 JSON 형식으로만 응답하세요. 다른 텍스트는 포함하지 마세요.`

  const userMessage = buildAnalysisPrompt(issueDetailsString, platformName, platformDescription)

  try {
    const content = await callOpenAI(systemMessage, userMessage, 4000)
    console.log(`[IssueAnalyzer] OpenAI API 분석 완료`)
    return parseAnalysisResult(content)
  } catch (error) {
    console.error(`[IssueAnalyzer] OpenAI API 분석 실패:`, error)
    return createFallbackAnalysis(issueDetailsString)
  }
}

/**
 * 이슈 상세 정보를 문자열로 포맷합니다.
 */
function formatIssueDetails(issue: SentryIssueDetail): string {
  return `
이슈 ID: ${issue.shortId}
제목: ${issue.title}
레벨: ${issue.level}
상태: ${issue.status}
발생 횟수: ${issue.count}회
영향받은 사용자: ${issue.userCount}명
첫 발생: ${issue.firstSeen}
마지막 발생: ${issue.lastSeen}
발생 위치: ${issue.culprit || '알 수 없음'}
링크: ${issue.permalink}
${issue.metadata ? `
에러 타입: ${issue.metadata.type || '없음'}
에러 값: ${issue.metadata.value || '없음'}
파일: ${issue.metadata.filename || '없음'}
함수: ${issue.metadata.function || '없음'}
` : ''}
${issue.tags ? `태그: ${issue.tags.map(t => `${t.key}=${t.value}`).join(', ')}` : ''}
`.trim()
}

/**
 * 분석 프롬프트를 생성합니다.
 */
function buildAnalysisPrompt(
  issueDetailsString: string,
  platformName: string,
  platformDescription: string
): string {
  return `다음 ${platformName} 앱의 Sentry 에러를 심층 분석해주세요.

**이슈 정보:**
${issueDetailsString}

핀다는 한국의 선도적인 핀테크 기업으로, 대출 비교, 신용카드 추천, 보험, 투자 등 포괄적인 금융 서비스를 제공하는 앱입니다.

다음 Sentry 정보들을 모두 면밀히 검토하여 전문가 수준의 심층 분석을 수행해주세요:

**▶ Sentry 분석 체크리스트:**
✓ Stack Trace 정보 (함수 호출 스택, 에러 발생 지점)
✓ Breadcrumbs 정보 (에러 발생 전 사용자 행동 패턴)
✓ Event Grouping Information (유사 에러 패턴 및 그룹핑 기준)
✓ User Context (디바이스, OS 버전, 앱 버전)
✓ Exception 상세 정보 (에러 타입, 메시지, 코드)

**▶ 1. 전문가 수준 심각도 평가 (high/medium/low)**
- **사용자 임팩트**: 앱 크래시, 데이터 손실, 거래 실패, UX 저하 정도
- **비즈니스 크리티컬**: 핀테크 특성상 금융거래, 개인정보, 신뢰도 영향 여부
- **기술적 복잡성**: 수정 난이도, 연관 시스템 영향, 배포 리스크
- **발생 빈도 및 트렌드**: 증가/감소 패턴, 특정 조건 의존성

**▶ 2. 정밀 에러 카테고리 분류**
- 시스템 에러 (메모리 부족, 백그라운드 제한, 권한 문제)
- 써드파티 SDK 에러 (Firebase, AppsFlyer, 광고SDK, 결제SDK)
- 네트워크/API 에러 (타임아웃, SSL, HTTP 상태코드, JSON 파싱)
- 앱 크래시 (메모리 접근 위반, 스택 오버플로우)
- UI/UX 스레드 에러 (메인스레드 블로킹, 백그라운드 UI 업데이트)
- 데이터 처리 에러 (데이터베이스, JSON, 직렬화)
- 보안 관련 에러 (인증, 암호화, 인증서)
- 성능 이슈 (ANR, 메모리 누수, 배터리 드레인, 렌더링)

**▶ 3. 근본 원인 심층 분석**
- 기술적 근본 원인 (에러 발생 메커니즘, 호출 경로, 사용자 시나리오)
- 코드 레벨 분석 (파일명, 클래스명, 메서드명, 라인 번호)
- 환경 및 컨텍스트 분석 (OS 버전, 디바이스, 네트워크 상태)

**▶ 4. 전문가 수준 해결 방안**
- 긴급 대응 (Hotfix/Rollback)
- 근본적 해결책
- 실제 코드 예시 (Before/After)
- 테스트 및 검증 방법

**▶ 5. 핀테크 특화 고려사항**
- 보안, 가용성, 사용자 신뢰, 데이터 무결성

**필수 JSON 응답 형식:**
{
    "severity": "high|medium|low",
    "category": "에러 카테고리",
    "rootCause": "20년차 전문가의 심층 원인 분석. 기술적 근본 원인을 상세히 설명. 최소 200자 이상",
    "solution": "전문가 수준의 완전한 해결방안. 긴급대응→근본해결→코드예시→테스트 순서로 제시. 최소 300자 이상"
}

**JSON만 응답하세요. 다른 텍스트는 포함하지 마세요.**`
}

/**
 * OpenAI 응답에서 JSON을 추출하고 파싱합니다.
 */
function parseAnalysisResult(content: string): IssueAnalysis {
  if (!content || content.trim() === '') {
    console.warn('[IssueAnalyzer] 빈 응답 수신')
    return createFallbackAnalysis('')
  }

  // JSON 블록 추출
  let jsonContent = content

  // 코드 블록 처리
  if (content.includes('```json')) {
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/)
    if (jsonMatch) {
      jsonContent = jsonMatch[1]
    }
  } else if (content.includes('```')) {
    const codeMatch = content.match(/```\s*([\s\S]*?)\s*```/)
    if (codeMatch) {
      jsonContent = codeMatch[1]
    }
  }

  jsonContent = jsonContent.trim()

  // JSON 객체 시작과 끝 찾기
  const firstBrace = jsonContent.indexOf('{')
  const lastBrace = jsonContent.lastIndexOf('}')

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    jsonContent = jsonContent.substring(firstBrace, lastBrace + 1)
  }

  try {
    const parsed = JSON.parse(jsonContent)

    // 필수 필드 검증
    if (!parsed.severity || !parsed.category || !parsed.rootCause || !parsed.solution) {
      console.warn('[IssueAnalyzer] 필수 필드 누락')
      return createFallbackAnalysis(content)
    }

    // severity 정규화
    const severity = parsed.severity.toLowerCase()
    if (!['high', 'medium', 'low'].includes(severity)) {
      parsed.severity = 'medium'
    } else {
      parsed.severity = severity
    }

    return parsed as IssueAnalysis
  } catch (error) {
    console.error('[IssueAnalyzer] JSON 파싱 실패:', error)
    console.error('[IssueAnalyzer] 원본 내용:', content.substring(0, 500))
    return createFallbackAnalysis(content)
  }
}

/**
 * 분석 실패 시 폴백 분석 결과를 생성합니다.
 */
function createFallbackAnalysis(context: string): IssueAnalysis {
  return {
    severity: 'medium',
    category: '분석 필요',
    rootCause: 'OpenAI API 분석이 일시적으로 실패했습니다. 수동 분석이 필요합니다. ' +
      (context ? `컨텍스트: ${context.substring(0, 200)}...` : ''),
    solution: '1. Sentry 대시보드에서 이슈 상세 정보를 직접 확인하세요.\n' +
      '2. Stack Trace와 Breadcrumbs를 검토하세요.\n' +
      '3. 유사한 이슈 패턴이 있는지 확인하세요.\n' +
      '4. 잠시 후 다시 분석을 시도해주세요.'
  }
}

/**
 * 상세 분석을 수행합니다.
 * 기존 분석 결과를 바탕으로 더 깊은 분석을 제공합니다.
 *
 * @param issueId - 이슈 ID
 * @param originalAnalysis - 기존 분석 결과
 * @param issueDetails - 이슈 상세 정보 (선택)
 * @returns DetailedAnalysis 상세 분석 결과
 */
export async function generateDetailedAnalysis(
  issueId: string,
  originalAnalysis: IssueAnalysis,
  issueDetails?: string | SentryIssueDetail
): Promise<DetailedAnalysis> {
  console.log(`[IssueAnalyzer] 상세 분석 시작: ${issueId}`)

  const issueDetailsString = issueDetails
    ? (typeof issueDetails === 'string' ? issueDetails : formatIssueDetails(issueDetails))
    : '상세 정보 없음'

  const systemMessage = `당신은 20년차 모바일 개발 전문가입니다.
Sentry 이슈 분석에 대한 상세 근거와 증거를 제시해주세요.
반드시 JSON 형식으로만 응답하세요.`

  const userMessage = buildDetailedAnalysisPrompt(originalAnalysis, issueDetailsString)

  try {
    const content = await callOpenAI(systemMessage, userMessage, 3000)
    console.log(`[IssueAnalyzer] 상세 분석 완료`)
    return parseDetailedAnalysisResult(content, originalAnalysis)
  } catch (error) {
    console.error(`[IssueAnalyzer] 상세 분석 실패:`, error)
    return createFallbackDetailedAnalysis(originalAnalysis)
  }
}

/**
 * 상세 분석 프롬프트를 생성합니다.
 */
function buildDetailedAnalysisPrompt(
  originalAnalysis: IssueAnalysis,
  issueDetailsString: string
): string {
  return `다음은 finda 앱에서 발생한 Sentry 이슈에 대한 기존 분석 결과입니다:

**기존 분석:**
- 심각도: ${originalAnalysis.severity}
- 카테고리: ${originalAnalysis.category}
- 원인: ${originalAnalysis.rootCause}
- 해결방안: ${originalAnalysis.solution}

**이슈 상세 정보:**
${issueDetailsString}

다음 5가지 관점에서 **구체적인 분석 근거와 증거**를 제시해주세요:

1. **Stack Trace 분석**: 어떤 스택 트레이스 패턴을 보고 그렇게 판단했는지 구체적으로 설명
2. **Breadcrumbs 패턴**: 사용자 행동 패턴이나 앱 상태 변화에서 어떤 단서를 발견했는지
3. **Event Grouping 기준**: 유사한 에러들이 어떤 기준으로 그룹핑되는지, 패턴의 공통점
4. **분석 근거**: 왜 그렇게 판단했는지의 논리적 근거와 기술적 증거
5. **참고 데이터**: 어떤 메타데이터나 컨텍스트 정보를 근거로 했는지

**JSON 형식으로만 응답하세요:**
{
    "stackTraceAnalysis": "스택 트레이스에서 발견한 구체적 패턴과 증거...",
    "breadcrumbsAnalysis": "브레드크럼에서 파악한 사용자 행동 패턴...",
    "eventGroupingAnalysis": "이벤트 그룹핑에서 발견한 공통 패턴...",
    "evidenceReasoning": "분석 결론에 도달한 논리적 근거와 기술적 증거...",
    "referenceData": "분석에 활용한 메타데이터와 컨텍스트 정보..."
}

**JSON만 응답하세요. 다른 텍스트는 포함하지 마세요.**`
}

/**
 * 상세 분석 결과를 파싱합니다.
 */
function parseDetailedAnalysisResult(
  content: string,
  originalAnalysis: IssueAnalysis
): DetailedAnalysis {
  try {
    let jsonContent = content

    // 코드 블록 처리
    if (content.includes('```json')) {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/)
      if (jsonMatch) {
        jsonContent = jsonMatch[1]
      }
    } else if (content.includes('```')) {
      const codeMatch = content.match(/```\s*([\s\S]*?)\s*```/)
      if (codeMatch) {
        jsonContent = codeMatch[1]
      }
    }

    jsonContent = jsonContent.trim()

    const firstBrace = jsonContent.indexOf('{')
    const lastBrace = jsonContent.lastIndexOf('}')

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonContent = jsonContent.substring(firstBrace, lastBrace + 1)
    }

    const parsed = JSON.parse(jsonContent)

    return {
      stackTraceAnalysis: parsed.stackTraceAnalysis || 'Stack Trace 분석 정보를 파싱할 수 없습니다.',
      breadcrumbsAnalysis: parsed.breadcrumbsAnalysis || 'Breadcrumbs 분석 정보를 파싱할 수 없습니다.',
      eventGroupingAnalysis: parsed.eventGroupingAnalysis || 'Event Grouping 분석 정보를 파싱할 수 없습니다.',
      evidenceReasoning: parsed.evidenceReasoning || '분석 근거 정보를 파싱할 수 없습니다.',
      referenceData: parsed.referenceData || '참고 데이터 정보를 파싱할 수 없습니다.'
    }
  } catch (error) {
    console.error('[IssueAnalyzer] 상세 분석 파싱 실패:', error)
    return createFallbackDetailedAnalysis(originalAnalysis)
  }
}

/**
 * 상세 분석 실패 시 폴백 결과를 생성합니다.
 */
function createFallbackDetailedAnalysis(originalAnalysis: IssueAnalysis): DetailedAnalysis {
  return {
    stackTraceAnalysis: `현재 OpenAI API가 일시적으로 과부하 상태입니다.
기존 분석 결과(${originalAnalysis.category})를 기반으로 일반적인 Stack Trace 분석 패턴:
- ${originalAnalysis.severity} 심각도의 에러는 주로 특정 함수 호출 스택에서 발생
- 에러 발생 지점의 호출 경로 분석이 필요한 상황`,

    breadcrumbsAnalysis: `사용자 행동 패턴 분석:
- 현재 카테고리(${originalAnalysis.category})의 에러는 특정 사용자 액션 후 발생하는 패턴
- 앱 상태 변화와 연관된 브레드크럼 추적 필요`,

    eventGroupingAnalysis: `이벤트 그룹핑 기준:
- 유사한 ${originalAnalysis.category} 에러들의 공통점 분석
- 동일한 코드 경로에서 발생하는 에러들의 패턴 확인`,

    evidenceReasoning: `분석 근거:
- 심각도 ${originalAnalysis.severity} 판정 이유: 에러의 영향도와 발생 빈도 고려
- ${originalAnalysis.category} 분류 근거: 에러 메시지와 발생 컨텍스트 분석`,

    referenceData: `참고 데이터:
- 에러 메타데이터와 태그 정보
- 디바이스 및 OS 버전 정보
- 앱 버전과 빌드 정보
- 네트워크 상태 및 사용자 컨텍스트`
  }
}

// 심각도에 따른 이모지 반환
export function getSeverityEmoji(severity: string): string {
  switch (severity.toLowerCase()) {
    case 'high': return '🚨'
    case 'medium': return '⚠️'
    case 'low': return 'ℹ️'
    default: return '❓'
  }
}

// 레벨에 따른 이모지 반환
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
