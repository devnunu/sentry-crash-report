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

type Platform = 'ios' | 'android' | 'web' | 'backend' | 'other'

interface PlatformConfig {
  name: string
  language: string
  frameworks: string[]
  commonIssues: string[]
  expertYears: number
  companies: string[]
  codeLanguage: string
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
  platform?: Platform
}

class AIAnalyzer {
  private apiKey: string
  private platformConfigs: Record<Platform, PlatformConfig>

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || ''
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required')
    }

    this.platformConfigs = {
      ios: {
        name: 'iOS 앱',
        language: 'Swift/Objective-C',
        frameworks: ['UIKit', 'SwiftUI', 'Core Data', 'Foundation', 'Alamofire', 'Firebase'],
        commonIssues: [
          'iOS 시스템 에러 (메모리 부족, 백그라운드 제한, 권한 문제)',
          '써드파티 SDK 에러 (Firebase, AppsFlyer, 광고SDK, 결제SDK)',
          'UI/UX 스레드 에러 (메인스레드 블로킹, 백그라운드 UI 업데이트)',
          '앱 크래시 (SIGABRT, SIGKILL, 메모리 접근 위반)',
          '보안 관련 에러 (Keychain, 생체인증, 암호화)',
          '성능 이슈 (ANR, 메모리 누수, 배터리 드레인)'
        ],
        expertYears: 20,
        companies: ['Apple', 'Google', 'Meta'],
        codeLanguage: 'Swift'
      },
      android: {
        name: 'Android 앱',
        language: 'Kotlin/Java',
        frameworks: ['Android SDK', 'Jetpack Compose', 'Room', 'Retrofit', 'Firebase', 'Dagger/Hilt'],
        commonIssues: [
          'Android 시스템 에러 (메모리 부족, Background Restriction, Permission)',
          'Activity/Fragment 생명주기 에러',
          'ANR (Application Not Responding)',
          'Native Crash (JNI, NDK 관련)',
          '써드파티 SDK 에러 (Firebase, 광고SDK, 결제SDK)',
          '성능 이슈 (메모리 누수, 배터리 드레인, GPU 오버드로우)'
        ],
        expertYears: 15,
        companies: ['Google', 'Samsung', 'Meta'],
        codeLanguage: 'Kotlin'
      },
      web: {
        name: '웹 애플리케이션',
        language: 'JavaScript/TypeScript',
        frameworks: ['React', 'Next.js', 'Vue.js', 'Angular', 'Node.js', 'Express'],
        commonIssues: [
          '브라우저 호환성 에러',
          'JavaScript 런타임 에러',
          'HTTP/네트워크 에러',
          'CORS 및 보안 정책 에러',
          'DOM 조작 및 렌더링 에러',
          '성능 이슈 (메모리 누수, 번들 사이즈, 렌더링)'
        ],
        expertYears: 12,
        companies: ['Google', 'Meta', 'Netflix'],
        codeLanguage: 'TypeScript'
      },
      backend: {
        name: '백엔드 서비스',
        language: 'Python/Java/Node.js',
        frameworks: ['Spring Boot', 'Django', 'FastAPI', 'Express', 'GraphQL', 'Redis'],
        commonIssues: [
          'HTTP 서버 에러 (4xx, 5xx)',
          '데이터베이스 연결 및 쿼리 에러',
          '인증/인가 에러',
          'API Gateway 및 MSA 에러',
          '성능 이슈 (응답시간, 처리량, 메모리)',
          '보안 취약점 (SQL Injection, XSS, CSRF)'
        ],
        expertYears: 18,
        companies: ['Google', 'Amazon', 'Microsoft'],
        codeLanguage: 'Python'
      },
      other: {
        name: '기타 플랫폼',
        language: 'Multi-language',
        frameworks: ['Various'],
        commonIssues: [
          '런타임 에러',
          '네트워크 에러',
          '데이터 처리 에러',
          '시스템 리소스 에러'
        ],
        expertYears: 15,
        companies: ['Various Tech Companies'],
        codeLanguage: 'Generic'
      }
    }
  }

  private detectPlatform(issueData: SentryIssueData): Platform {
    // 명시적으로 플랫폼이 지정된 경우
    if (issueData.platform) {
      return issueData.platform
    }

    // 태그에서 플랫폼 정보 추출
    const tags = issueData.tags || []
    for (const tag of tags) {
      if ((tag.key === 'platform' || tag.key === 'os.name') && tag.value) {
        const value = tag.value.toLowerCase()
        if (value.includes('ios') || value.includes('iphone') || value.includes('ipad')) {
          return 'ios'
        }
        if (value.includes('android')) {
          return 'android'
        }
        if (value.includes('web') || value.includes('browser')) {
          return 'web'
        }
      }
    }

    // 컨텍스트에서 플랫폼 정보 추출
    if (issueData.context) {
      if (issueData.context.os?.name && issueData.context.os.name.toLowerCase().includes('ios')) {
        return 'ios'
      }
      if (issueData.context.os?.name && issueData.context.os.name.toLowerCase().includes('android')) {
        return 'android'
      }
      if (issueData.context.browser) {
        return 'web'
      }
    }

    // 스택 트레이스에서 플랫폼 추정
    if (issueData.stackTrace && typeof issueData.stackTrace === 'string') {
      const stackTrace = issueData.stackTrace.toLowerCase()
      if (stackTrace.includes('swift') || stackTrace.includes('objective-c') || stackTrace.includes('ios')) {
        return 'ios'
      }
      if (stackTrace.includes('kotlin') || (stackTrace.includes('java') && stackTrace.includes('android'))) {
        return 'android'
      }
      if (stackTrace.includes('javascript') || stackTrace.includes('typescript') || stackTrace.includes('node')) {
        return 'web'
      }
      if (stackTrace.includes('python') || stackTrace.includes('django') || stackTrace.includes('fastapi')) {
        return 'backend'
      }
    }

    // 이슈 제목에서 플랫폼 추정
    if (issueData.title && typeof issueData.title === 'string') {
      const title = issueData.title.toLowerCase()
      if (title.includes('ios') || title.includes('swift') || title.includes('uikit')) {
        return 'ios'
      }
      if (title.includes('android') || title.includes('kotlin') || title.includes('java')) {
        return 'android'
      }
    }

    return 'other'
  }

  private getPlatformSpecificIntro(platform: Platform): string {
    const config = this.platformConfigs[platform]
    
    switch (platform) {
      case 'ios':
        return '핀다는 한국의 선도적인 핀테크 기업으로, 대출 비교, 신용카드 추천, 보험, 투자 등 포괄적인 금융 서비스를 제공하는 iOS 앱입니다.'
      case 'android':
        return '핀다는 한국의 선도적인 핀테크 기업으로, 대출 비교, 신용카드 추천, 보험, 투자 등 포괄적인 금융 서비스를 제공하는 Android 앱입니다.'
      case 'web':
        return '핀다는 한국의 선도적인 핀테크 기업으로, 대출 비교, 신용카드 추천, 보험, 투자 등 포괄적인 금융 서비스를 제공하는 웹 플랫폼입니다.'
      case 'backend':
        return '핀다는 한국의 선도적인 핀테크 기업으로, 대출 비교, 신용카드 추천, 보험, 투자 등 포괄적인 금융 서비스를 제공하는 백엔드 시스템입니다.'
      default:
        return '핀다는 한국의 선도적인 핀테크 기업으로, 포괄적인 금융 서비스를 제공하는 플랫폼입니다.'
    }
  }

  private getPlatformSpecificCategories(platform: Platform): string {
    const config = this.platformConfigs[platform]
    return config.commonIssues.map(issue => `- ${issue}`).join('\n')
  }

  private getPlatformSpecificConsiderations(platform: Platform): string {
    switch (platform) {
      case 'ios':
        return `**▶ iOS 특화 고려사항**
- **App Store 리뷰**: Apple App Store 가이드라인 준수 여부
- **iOS 버전 호환성**: 다양한 iOS 버전별 동작 차이
- **디바이스 호환성**: iPhone, iPad 등 디바이스별 특성
- **메모리 관리**: ARC, 순환 참조, 메모리 압박 상황
- **백그라운드 제한**: iOS Background App Refresh 정책
- **권한 관리**: 위치, 카메라, 알림 등 시스템 권한`
      
      case 'android':
        return `**▶ Android 특화 고려사항**
- **Google Play 정책**: Google Play Console 정책 준수
- **Android 버전 파편화**: API 레벨별 호환성 이슈  
- **디바이스 다양성**: 제조사별, 화면 크기별 차이
- **메모리 관리**: GC, OutOfMemoryError, 메모리 누수
- **백그라운드 최적화**: Doze 모드, App Standby 정책
- **권한 시스템**: Runtime Permission, Scoped Storage`
      
      case 'web':
        return `**▶ 웹 특화 고려사항**
- **브라우저 호환성**: Chrome, Safari, Firefox, Edge 등
- **성능 최적화**: Core Web Vitals, 렌더링 성능
- **보안**: HTTPS, CSP, CORS, XSS 방지
- **접근성**: WCAG 가이드라인, 스크린 리더 지원
- **SEO**: 검색 엔진 최적화, 메타 태그
- **PWA**: Service Worker, 오프라인 지원`
      
      case 'backend':
        return `**▶ 백엔드 특화 고려사항**
- **확장성**: 수평/수직 스케일링, 로드 밸런싱
- **보안**: API 보안, 인증/인가, 데이터 암호화
- **성능**: 응답시간, 처리량, 데이터베이스 최적화
- **모니터링**: APM, 로그 관리, 알림 시스템  
- **장애 복구**: Circuit Breaker, Retry, Fallback
- **데이터 일관성**: 트랜잭션, ACID, 분산 시스템`
      
      default:
        return `**▶ 일반적인 고려사항**
- **성능**: 응답 시간, 메모리 사용량, CPU 사용률
- **안정성**: 오류율, 가용성, 복구 시간
- **보안**: 취약점 점검, 데이터 보호
- **사용자 경험**: 접근성, 사용성, 반응성`
    }
  }

  private getPlatformSpecificReferences(platform: Platform): string {
    switch (platform) {
      case 'ios':
        return 'Apple 공식 문서, iOS Human Interface Guidelines, Swift 공식 문서'
      case 'android':
        return 'Android Developer 공식 문서, Material Design Guidelines, Kotlin 공식 문서'
      case 'web':
        return 'MDN Web Docs, W3C 표준, 브라우저 공식 문서'
      case 'backend':
        return '프레임워크 공식 문서, REST API 가이드라인, 클라우드 공식 문서'
      default:
        return '관련 플랫폼 공식 문서'
    }
  }

  private buildAnalysisPrompt(issueData: SentryIssueData): string {
    const platform = this.detectPlatform(issueData)
    const config = this.platformConfigs[platform]
    
    const contextInfo = [
      `이슈 ID: ${issueData.shortId || issueData.issueId}`,
      `제목: ${issueData.title || '제목 없음'}`,
      `플랫폼: ${config.name} (${config.language})`,
      `레벨: ${issueData.level || 'unknown'}`,
      `발생 횟수: ${issueData.eventCount || 0}회`,
      `영향받은 사용자: ${issueData.userCount || 0}명`,
      `첫 발생: ${issueData.firstSeen || '알 수 없음'}`,
      `마지막 발생: ${issueData.lastSeen || '알 수 없음'}`
    ].join('\n')

    // 길이 제한을 더 엄격하게 적용
    const stackTrace = issueData.stackTrace ? 
      `\n스택 트레이스:\n${issueData.stackTrace.substring(0, 2000)}` : 
      '\n스택 트레이스: 없음'

    const breadcrumbs = issueData.breadcrumbs && issueData.breadcrumbs.length > 0 ? 
      `\n브레드크럼:\n${JSON.stringify(issueData.breadcrumbs.slice(-5), null, 2).substring(0, 1000)}` : 
      '\n브레드크럼: 없음'

    const tags = issueData.tags && issueData.tags.length > 0 ? 
      `\n태그:\n${issueData.tags.slice(0, 10).map(tag => `${tag.key}: ${tag.value || ''}`).join('\n')}` : 
      '\n태그: 없음'

    const context = issueData.context ? 
      `\n컨텍스트:\n${JSON.stringify(issueData.context, null, 2).substring(0, 1000)}` : 
      '\n컨텍스트: 없음'

    const platformSpecificIntro = this.getPlatformSpecificIntro(platform)
    
    // 프롬프트 길이 제한 - 전체 프롬프트가 너무 길면 400 에러 발생 가능
    const totalDataLength = contextInfo.length + stackTrace.length + breadcrumbs.length + tags.length + context.length
    console.log(`[AIAnalyzer] Prompt data length: ${totalDataLength}`)

    return `핀다 ${config.name} Sentry 이슈 분석 요청

**이슈 정보:**
${contextInfo}
${stackTrace}
${breadcrumbs}
${tags}
${context}

**분석 요청:**
${config.expertYears}년차 ${config.name} 전문가로서 이 이슈를 분석해주세요.
${platformSpecificIntro}

**분석 필요 항목:**
1. 심각도 평가 (CRITICAL/HIGH/MEDIUM/LOW)
2. 에러 카테고리 분류
3. 근본 원인 분석
4. 해결 방안 제시
5. ${config.codeLanguage} 코드 예시

${this.getPlatformSpecificConsiderations(platform)}

**응답 형식 (JSON만):**
{
  "severity": "레벨",
  "category": "카테고리명",
  "rootCause": "간단한 원인 요약",
  "detailedAnalysis": "상세한 분석 내용 (핀테크 특화 고려사항 포함)",
  "solutions": {
    "immediate": ["긴급 대응 방안들"],
    "longTerm": ["근본적 해결 방안들"],
    "codeExample": "${config.codeLanguage} 코드 개선 예시",
    "monitoring": ["모니터링 방안들"],
    "prevention": ["예방 방안들"]
  },
  "references": ["${this.getPlatformSpecificReferences(platform)}"],
  "detailedEvidence": {
    "stackTrace": "Stack Trace 분석",
    "breadcrumbs": "Breadcrumbs 분석", 
    "eventGrouping": "Event Grouping 분석",
    "analysisReasoning": "분석 근거",
    "referenceData": ["참고 데이터들"]
  }
}`
  }

  async analyzeIssue(issueData: SentryIssueData): Promise<AIAnalysisResult> {
    const platform = this.detectPlatform(issueData)
    const config = this.platformConfigs[platform]
    let prompt = this.buildAnalysisPrompt(issueData)
    
    console.log(`[AIAnalyzer] Analyzing ${config.name} issue: ${issueData.shortId || issueData.issueId}`)
    
    try {
      const systemMessage = `당신은 ${config.expertYears}년차 ${config.name} 개발 전문가이며 핀테크 도메인에 특화된 Sentry 에러 분석 전문가입니다. ${config.language} 언어와 ${config.frameworks.join(', ')} 프레임워크에 깊은 전문 지식을 가지고 있습니다. 

**중요:** 반드시 순수한 JSON 형식으로만 응답하세요. 코드 블록이나 추가 설명 없이 JSON만 반환하세요. 실무에서 즉시 적용 가능한 구체적이고 전문적인 분석을 제공합니다.`

      // 프롬프트 길이 제한 (OpenAI API 토큰 제한 고려)
      if (prompt.length > 8000) {
        console.warn(`[AIAnalyzer] Prompt too long (${prompt.length} chars), truncating...`)
        prompt = prompt.substring(0, 8000) + '\n\n**Note:** 프롬프트가 길어서 일부 정보가 생략되었습니다.'
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini', // 더 안정적이고 빠른 모델
          messages: [
            {
              role: 'system',
              content: systemMessage
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.1,
          max_tokens: 4000 // 토큰 수 줄임
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[AIAnalyzer] OpenAI API error:', errorText)
        console.error('[AIAnalyzer] Request payload preview:', {
          model: 'gpt-4-turbo-preview',
          systemMessage: systemMessage.substring(0, 200) + '...',
          promptLength: prompt.length,
          temperature: 0.1,
          max_tokens: 6000
        })
        throw new Error(`OpenAI API request failed: ${response.status} - ${response.statusText}: ${errorText}`)
      }

      const data = await response.json()
      let content = data.choices[0].message.content

      console.log('[AIAnalyzer] Received response from OpenAI')

      // JSON 파싱 - 코드 블록 및 불필요한 텍스트 제거
      let analysisResult: AIAnalysisResult
      try {
        // 다양한 코드 블록 형태 처리
        if (content.includes('```json')) {
          const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/)
          if (jsonMatch) {
            content = jsonMatch[1]
          }
        } else if (content.includes('```')) {
          const codeMatch = content.match(/```\s*([\s\S]*?)\s*```/)
          if (codeMatch) {
            content = codeMatch[1]
          }
        }
        
        // 추가적인 정리 - 앞뒤 공백과 개행 제거, JSON 시작/끝 찾기
        content = content.trim()
        
        // JSON 객체 시작과 끝을 찾아서 추출
        const firstBrace = content.indexOf('{')
        const lastBrace = content.lastIndexOf('}')
        
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          content = content.substring(firstBrace, lastBrace + 1)
        }
        
        analysisResult = JSON.parse(content)
      } catch (parseError) {
        console.error('[AIAnalyzer] Failed to parse OpenAI response as JSON:', content.substring(0, 500) + '...')
        console.error('[AIAnalyzer] Parse error:', parseError)
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

export async function performAIAnalysis(issueData: SentryIssueData, explicitPlatform?: Platform): Promise<AIAnalysisResult> {
  const analyzer = new AIAnalyzer()
  
  // 명시적으로 플랫폼이 지정된 경우 사용
  if (explicitPlatform) {
    issueData = { ...issueData, platform: explicitPlatform }
  }
  
  return analyzer.analyzeIssue(issueData)
}

// 타입들을 외부에서 사용할 수 있도록 export
export type { Platform, SentryIssueData, AIAnalysisResult, PlatformConfig }

export default AIAnalyzer