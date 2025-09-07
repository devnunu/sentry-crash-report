import type { DailyReportData, AIAnalysis, TopIssue } from './types'

export class AIAnalysisService {
  
  async generateDailyAdvice(
    reportData: DailyReportData,
    targetDateKey: string,
    prevDateKey?: string,
    environment?: string
  ): Promise<AIAnalysis> {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required for AI analysis')
    }

    try {
      const { default: OpenAI } = await import('openai')
      const client = new OpenAI({ apiKey })

      // 어제 상위 5 이슈 간단 버전
      const targetData = typeof reportData[targetDateKey] === 'object' ? reportData[targetDateKey] as any : {}
      const topIssues = (targetData.top_5_issues || []) as TopIssue[]
      const topIssuesCompact = topIssues.map(issue => ({
        issue_id: issue.issue_id,
        title: issue.title,
        event_count: issue.event_count
      }))

      const prompt = this.buildDailyAnalysisPrompt(
        reportData,
        targetDateKey,
        prevDateKey,
        topIssuesCompact,
        environment
      )

      const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.7,
        max_tokens: 900,
        messages: [{ role: 'user', content: prompt }]
      })

      let text = response.choices[0]?.message?.content?.trim() || ''
      
      // 코드블록으로 감싸진 경우 JSON만 추출
      if (text.startsWith('```')) {
        const match = text.match(/\{.*\}/s)
        if (match) {
          text = match[0]
        }
      }

      const data = JSON.parse(text)
      
      // 데이터 정규화
      return this.normalizeAIAnalysis(data, topIssues)
    } catch (error) {
      console.error('AI analysis failed:', error)
      const snippet = text ? text.substring(0, 200) : '(no text)'
      // Python의 fallback_text 형태로 반환
      return {
        fallback_text: `AI 조언 생성 실패: ${error instanceof Error ? `${error.constructor.name}: ${error.message}` : 'Unknown error'} | snippet=${snippet}`
      } as any
    }
  }

  private buildDailyAnalysisPrompt(
    reportData: DailyReportData,
    targetDateKey: string,
    prevDateKey?: string,
    topIssuesCompact: Array<{ issue_id: string; title: string; event_count: number }>,
    environment?: string
  ): string {
    return `당신은 Sentry 오류 리포트를 분석하는 친근한 AI 코치입니다. 
친근하고 자연스러운 말투로, 개발자에게 도움이 될 인사이트를 주세요. 
데이터를 그냥 나열하지 말고 의미 있는 포인트만 뽑아주세요. 인사이트가 없다면 간단히 넘어가도 됩니다. 
마지막엔 오늘 상황을 한두 문장으로 친근하게 요약(가벼운 농담/격려 허용, 중요한 경고는 분명히)하세요.

=== 분석 맥락 ===
- 이 리포트는 '어제(${targetDateKey})' 기준 Summary 데이터입니다. 비교 대상은 '그저께(${prevDateKey || 'N/A'})'입니다.
- 이벤트(crash_events): level이 fatal, error인 이벤트 발생 건수입니다.
- 이슈(unique_issues): 위 이벤트가 속한 고유 이슈 개수입니다.
- 영향 사용자(impacted_users): 해당 이슈로 영향을 받은 사용자 수입니다.
- Crash Free: 'crash_free_rate(session/user)'로, 높은 값일수록 안정적입니다.
${environment ? `- 환경: ${environment}` : ''}

=== 출력 형식 ===
반드시 **순수 JSON만** 출력하세요. 코드블록(\`\`\`json\`)로 감싸지 마세요.
{
  "newsletter_summary": "",   
  "today_actions": [ {"title":"", "why":"", "owner_role":"", "suggestion":""} ],
  "root_cause": [],
  "per_issue_notes": [ {"issue_title":"", "note":""} ]
}

=== per_issue_notes 작성 규칙 ===
- 아래 상위 5개 이슈 중 **의미 있는 항목만** 코멘트를 남기세요(불필요하면 생략 가능).
- \`issue_title\`은 반드시 아래 title 문자열을 그대로 사용하세요(변형 금지).

[상위 5개 이슈 (요약)]
${JSON.stringify(topIssuesCompact, null, 2)}

=== 전체 Summary JSON ===
${JSON.stringify(reportData, null, 2)}`
  }

  private normalizeAIAnalysis(data: any, topIssues: TopIssue[]): AIAnalysis {
    // 기본 키/타입 보정
    const result: AIAnalysis = {
      newsletter_summary: String(data.newsletter_summary || ''),
      today_actions: [],
      root_cause: Array.isArray(data.root_cause) ? data.root_cause.map(String) : [],
      per_issue_notes: []
    }

    // 액션 항목 정규화
    if (Array.isArray(data.today_actions)) {
      result.today_actions = data.today_actions
        .filter((x: any) => typeof x === 'object' && x !== null)
        .map((x: any) => ({
          title: String(x.title || '').trim(),
          why: String(x.why || '').trim(),
          owner_role: String(x.owner_role || '').trim(),
          suggestion: String(x.suggestion || '').trim()
        }))
        .filter((action: any) => Object.values(action).some(v => v))
    }

    // per_issue_notes 정규화
    if (Array.isArray(data.per_issue_notes)) {
      result.per_issue_notes = data.per_issue_notes
        .filter((x: any) => typeof x === 'object' && x !== null)
        .map((x: any) => ({
          issue_title: String(x.issue_title || '').trim(),
          note: String(x.note || '').trim()
        }))
        .filter((note: any) => note.issue_title && note.note)
    }

    // 폴백: per_issue_notes가 비었고 root_cause가 있으면 top1에 한 줄 붙여줌
    if (result.per_issue_notes.length === 0 && result.root_cause.length > 0 && topIssues.length > 0) {
      result.per_issue_notes = [{
        issue_title: topIssues[0].title || '(제목 없음)',
        note: result.root_cause[0]
      }]
    }

    return result
  }

  async generateWeeklyAdvice(
    reportData: any,
    environment?: string
  ): Promise<AIAnalysis> {
    // 주간 리포트는 일단 간단한 요약만 제공
    return {
      newsletter_summary: '주간 리포트가 성공적으로 생성되었습니다. 상세한 분석은 각 섹션을 확인해주세요.',
      today_actions: [],
      root_cause: [],
      per_issue_notes: []
    }
  }
}

export const aiAnalysisService = new AIAnalysisService()