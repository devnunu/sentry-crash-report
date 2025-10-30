import type { DailyReportData, AIAnalysis, TopIssue, NewIssue, SurgeIssue, WeeklyReportData, WeeklyAIAnalysis } from './types'

interface CriticalIssue {
  issue_id: string
  title: string
  event_count: number
  users?: number
}

interface Avg7DaysData {
  events: number
  issues: number
  users: number
  crashFreeRate: number
}

export class AIAnalysisService {

  async generateDailyAdvice(
    reportData: DailyReportData,
    targetDateKey: string,
    prevDateKey?: string,
    environment?: string,
    avg7Days?: Avg7DaysData,
    criticalIssues?: CriticalIssue[]
  ): Promise<AIAnalysis> {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required for AI analysis')
    }

    const maxRetries = 2
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const { default: OpenAI } = await import('openai')
        const client = new OpenAI({ apiKey })

        const targetData = typeof reportData[targetDateKey] === 'object' ? reportData[targetDateKey] as any : {}
        const prevData = prevDateKey && typeof reportData[prevDateKey] === 'object' ? reportData[prevDateKey] as any : undefined

        // 이슈 데이터 수집
        const topIssues = (targetData.top_5_issues || targetData.issues?.slice(0, 5) || []) as TopIssue[]
        const newIssues = (targetData.new_issues || []) as NewIssue[]
        const surgeIssues = (targetData.surge_issues || []) as SurgeIssue[]

        const prompt = this.buildDailyAnalysisPrompt(
          targetData,
          prevData,
          targetDateKey,
          prevDateKey,
          topIssues,
          newIssues,
          surgeIssues,
          criticalIssues,
          avg7Days,
          environment
        )

        const response = await client.chat.completions.create({
          model: 'gpt-4o-mini',
          temperature: 0.7,
          max_tokens: 3000, // 증가됨 (1500 -> 3000)
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' }
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
        console.error(`AI analysis attempt ${attempt} failed:`, error)
        lastError = error as Error

        // 마지막 시도가 아니면 재시도
        if (attempt < maxRetries) {
          console.log(`Retrying... (${attempt}/${maxRetries})`)
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt)) // 지수 백오프
          continue
        }
      }
    }

    // 모든 재시도 실패 시 fallback
    const errorMsg = lastError ? `${lastError.constructor.name}: ${lastError.message}` : 'Unknown error'
    return {
      fallback_text: `AI 조언 생성 실패 (${maxRetries}회 시도): ${errorMsg}`,
      newsletter_summary: 'AI 분석을 생성하지 못했습니다.',
      today_actions: [],
      root_cause: [],
      per_issue_notes: []
    } as AIAnalysis
  }

  private buildDailyAnalysisPrompt(
    targetData: any,
    prevData: any,
    targetDateKey: string,
    prevDateKey: string | undefined,
    topIssues: TopIssue[],
    newIssues: NewIssue[],
    surgeIssues: SurgeIssue[],
    criticalIssues: CriticalIssue[] = [],
    avg7Days?: Avg7DaysData,
    environment?: string
  ): string {
    const yesterday = {
      events: targetData.crash_events || 0,
      issues: targetData.unique_issues || 0,
      users: targetData.impacted_users || 0,
      crashFreeRate: targetData.crash_free_users_pct ? (targetData.crash_free_users_pct * 100) : 100
    }

    const dayBefore = prevData ? {
      events: prevData.crash_events || 0,
      issues: prevData.unique_issues || 0,
      users: prevData.impacted_users || 0,
      crashFreeRate: prevData.crash_free_users_pct ? (prevData.crash_free_users_pct * 100) : 100
    } : undefined

    // 간결한 이슈 정보
    const topIssuesCompact = topIssues.map(issue => ({
      issue_id: issue.issue_id,
      title: issue.title,
      event_count: issue.event_count
    }))

    const newIssuesCompact = newIssues.map(issue => ({
      issue_id: issue.issue_id,
      title: issue.title,
      event_count: issue.event_count || 0
    }))

    const surgeIssuesCompact = surgeIssues.slice(0, 5).map(issue => ({
      issue_id: issue.issue_id,
      title: issue.title,
      event_count: issue.event_count,
      dby_count: issue.dby_count || 0,
      growth_multiplier: issue.growth_multiplier,
      baseline_mean: issue.baseline_mean,
      baseline_counts: issue.baseline_counts
    }))

    return `당신은 Sentry 오류 리포트를 분석하는 전문 AI 분석가입니다.
개발자에게 실질적인 도움이 되는 인사이트와 액션 아이템을 제공하세요.

=== 분석 맥락 ===
- 대상 날짜: 어제 (${targetDateKey})
- 비교 날짜: 그저께 (${prevDateKey || 'N/A'})
- 이벤트(crash_events): level이 fatal, error인 이벤트 발생 건수
- 이슈(unique_issues): 위 이벤트가 속한 고유 이슈 개수
- 영향 사용자(impacted_users): 해당 이슈로 영향을 받은 사용자 수
- Crash Free Rate: 높을수록 안정적 (99.5% 이상 목표)
${environment ? `- 환경: ${environment}` : ''}

=== 심각도 판단 기준 ===
**critical** (긴급 조치 필요):
- Crash Free Rate < 99.0%
- 크래시 이벤트가 전일 대비 200% 이상 급증
- Crash Free Rate가 1.0%p 이상 하락
- Critical 이슈 발생 (신규 Fatal + 영향 사용자 많음, 또는 이벤트 500건 이상)

**warning** (주의 필요):
- Crash Free Rate 99.0~99.5%
- 크래시 이벤트가 전일 대비 100% 이상 증가
- Crash Free Rate가 0.5~1.0%p 하락
- 급증 이슈 발생

**normal** (정상):
- 위 조건에 해당하지 않음

=== 어제 데이터 ===
- 크래시 이벤트: ${yesterday.events}건
- 고유 이슈: ${yesterday.issues}개
- 영향 사용자: ${yesterday.users}명
- Crash Free Rate: ${yesterday.crashFreeRate.toFixed(2)}%

${dayBefore ? `=== 그저께 데이터 ===
- 크래시 이벤트: ${dayBefore.events}건
- 고유 이슈: ${dayBefore.issues}개
- 영향 사용자: ${dayBefore.users}명
- Crash Free Rate: ${dayBefore.crashFreeRate.toFixed(2)}%
` : ''}

${avg7Days ? `=== 최근 7일 평균 ===
- 크래시 이벤트: ${Math.round(avg7Days.events)}건
- 고유 이슈: ${Math.round(avg7Days.issues)}개
- 영향 사용자: ${Math.round(avg7Days.users)}명
- Crash Free Rate: ${avg7Days.crashFreeRate.toFixed(2)}%
` : ''}

=== 상위 이슈 ===
${JSON.stringify(topIssuesCompact, null, 2)}

${newIssuesCompact.length > 0 ? `=== 신규 이슈 (${newIssuesCompact.length}건) ===
${JSON.stringify(newIssuesCompact, null, 2)}
` : ''}

${surgeIssuesCompact.length > 0 ? `=== 급증 이슈 (${surgeIssuesCompact.length}건) ===
${JSON.stringify(surgeIssuesCompact, null, 2)}
` : ''}

${criticalIssues && criticalIssues.length > 0 ? `=== Critical 이슈 (${criticalIssues.length}건) ===
${JSON.stringify(criticalIssues, null, 2)}
` : ''}

=== 출력 형식 (JSON) ===
반드시 아래 형식의 순수 JSON만 출력하세요. 코드블록 없이, 다른 텍스트 없이 JSON만 출력하세요.

{
  "status_summary": {
    "level": "critical" | "warning" | "normal",
    "headline": "한 줄 요약 (예: '안정적인 하루', '주의 필요', '긴급 조치 필요')",
    "detail": "2-3문장으로 전체 상황 요약. 크래시 증감, Crash Free Rate, 주요 이슈 언급",
    "full_analysis": {
      "overview": "전체 상황 요약 (2-3문장). 크래시 이벤트 건수, 전일 대비 증감, Crash Free Rate 등을 포함하여 전반적인 상황을 설명.",
      "trend_analysis": "최근 트렌드 분석 (2-3문장). 최근 7일 평균과 비교, surge_issues의 baseline_counts를 참고하여 추세(개선/악화) 설명.",
      "key_insights": [
        "핵심 인사이트 1: 가장 주목해야 할 이슈나 패턴",
        "핵심 인사이트 2: 개선이 필요한 부분이나 위험 요소"
      ],
      "recommendations": "권장 사항 (1-2문장). 다음에 취해야 할 액션 또는 모니터링 포인트를 간결하게 제시."
    }
  },
  "today_actions": [
    {
      "priority": "high" | "medium" | "low",
      "issue_id": "Sentry Issue ID",
      "title": "구체적인 액션 제목 (예: 'LoanApplyScrapeService에서 intent null 체크 추가')",
      "why": "왜 이 액션이 필요한가? 발생 건수, 영향 사용자, 신규/급증 여부 포함",
      "owner_role": "담당자 역할 (예: '대출 기능 담당자', 'Android 팀')",
      "suggestion": "구체적인 해결 방법. 코드 레벨의 제안 포함 (예: 'onStartCommand 메서드에서 intent null 체크 추가')",
      "estimated_time": "예상 소요 시간 (예: '30분', '1시간', '반나절')",
      "impact": "이 액션의 예상 효과 (예: '17명 사용자 크래시 해소, Crash Free Rate 0.2%p 향상 예상')"
    }
  ],
  "important_issue_analysis": [
    {
      "issue_id": "Sentry Issue ID",
      "issue_title": "이슈 제목 (원문 그대로)",
      "analysis": {
        "root_cause": "이 이슈의 원인을 2-3문장으로 설명. Stack trace 기반 분석",
        "user_impact": "사용자에게 미치는 영향 1-2문장. 몇 명 영향, 어떤 기능 문제",
        "fix_suggestion": "해결 방법 2-3문장. 구체적인 코드 수정 방향 제시",
        "code_location": "문제 발생 위치. 예: kr.co.finda.MainActivity:120",
        "similar_issues": "과거 비슷한 이슈가 있었다면 언급. 없으면 생략 가능"
      }
    }
  ]
}

=== 작성 규칙 ===
1. **status_summary.level**: 위의 '심각도 판단 기준'을 엄격히 따라 판정하세요.

2. **today_actions**:
   - 실행 가능한 액션만 제시 (최대 5개)
   - priority: high(즉시 조치), medium(24시간 내), low(주간 계획)
   - issue_id: 반드시 위 이슈 목록의 정확한 ID 사용
   - suggestion: 코드 레벨의 구체적인 제안 포함
   - estimated_time: 현실적인 시간 추정
   - impact: 정량적인 효과 예측 (가능한 경우)

3. **important_issue_analysis**:
   - Critical/신규/급증 이슈 중 중요한 것만 선택 (최대 5개)
   - issue_id와 issue_title은 위 이슈 목록의 정확한 값 사용
   - analysis의 모든 필드를 상세히 작성
   - similar_issues는 있을 경우만 작성

4. **일반 지침**:
   - 데이터를 나열하지 말고, 의미 있는 인사이트 제공
   - 친근하고 실용적인 톤 유지
   - 불필요한 칭찬이나 격려는 지양, 사실 기반 분석
   - 정보가 부족하면 무리하게 추측하지 말고 "추가 로깅 필요" 등으로 표현`
  }

  private normalizeAIAnalysis(data: any, topIssues: TopIssue[]): AIAnalysis {
    const result: AIAnalysis = {
      today_actions: [],
      root_cause: [],
      per_issue_notes: []
    }

    // 새로운 구조: status_summary
    if (data.status_summary && typeof data.status_summary === 'object') {
      result.status_summary = {
        level: data.status_summary.level || 'normal',
        headline: String(data.status_summary.headline || ''),
        detail: String(data.status_summary.detail || ''),
        full_analysis: data.status_summary.full_analysis ? {
          overview: String(data.status_summary.full_analysis.overview || ''),
          trend_analysis: String(data.status_summary.full_analysis.trend_analysis || ''),
          key_insights: Array.isArray(data.status_summary.full_analysis.key_insights)
            ? data.status_summary.full_analysis.key_insights.map(String).filter(Boolean)
            : [],
          recommendations: String(data.status_summary.full_analysis.recommendations || '')
        } : {
          overview: '',
          trend_analysis: '',
          key_insights: [],
          recommendations: ''
        }
      }

      // 하위 호환성: newsletter_summary와 full_analysis 채우기
      result.newsletter_summary = result.status_summary.detail
      result.full_analysis = result.status_summary.full_analysis
    } else {
      // 구버전 fallback: newsletter_summary 사용
      result.newsletter_summary = String(data.newsletter_summary || '')

      if (data.full_analysis && typeof data.full_analysis === 'object') {
        result.full_analysis = {
          overview: String(data.full_analysis.overview || ''),
          trend_analysis: String(data.full_analysis.trend_analysis || ''),
          key_insights: Array.isArray(data.full_analysis.key_insights)
            ? data.full_analysis.key_insights.map(String).filter(Boolean)
            : [],
          recommendations: String(data.full_analysis.recommendations || '')
        }
      }
    }

    // today_actions 정규화
    if (Array.isArray(data.today_actions)) {
      result.today_actions = data.today_actions
        .filter((x: any) => typeof x === 'object' && x !== null)
        .map((x: any) => ({
          title: String(x.title || '').trim(),
          why: String(x.why || '').trim(),
          owner_role: String(x.owner_role || '').trim(),
          suggestion: String(x.suggestion || '').trim(),
          priority: x.priority && ['high', 'medium', 'low'].includes(x.priority) ? x.priority : undefined,
          issue_id: x.issue_id ? String(x.issue_id).trim() : undefined,
          estimated_time: x.estimated_time ? String(x.estimated_time).trim() : undefined,
          impact: x.impact ? String(x.impact).trim() : undefined
        }))
        .filter((action: any) => action.title && action.why)
    }

    // important_issue_analysis 정규화
    if (Array.isArray(data.important_issue_analysis)) {
      result.important_issue_analysis = data.important_issue_analysis
        .filter((x: any) => typeof x === 'object' && x !== null)
        .map((x: any) => ({
          issue_id: String(x.issue_id || '').trim(),
          issue_title: String(x.issue_title || '').trim(),
          analysis: x.analysis && typeof x.analysis === 'object' ? {
            root_cause: String(x.analysis.root_cause || '').trim(),
            user_impact: String(x.analysis.user_impact || '').trim(),
            fix_suggestion: String(x.analysis.fix_suggestion || '').trim(),
            code_location: String(x.analysis.code_location || '').trim(),
            similar_issues: x.analysis.similar_issues ? String(x.analysis.similar_issues).trim() : undefined
          } : {
            root_cause: '',
            user_impact: '',
            fix_suggestion: '',
            code_location: ''
          }
        }))
        .filter((issue: any) => issue.issue_id && issue.issue_title && issue.analysis.root_cause)

      // 하위 호환성: per_issue_notes도 채우기
      result.per_issue_notes = result.important_issue_analysis.map(issue => ({
        issue_title: issue.issue_title,
        issue_id: issue.issue_id,
        analysis: issue.analysis
      }))
    } else if (Array.isArray(data.per_issue_notes)) {
      // 구버전 per_issue_notes 처리
      result.per_issue_notes = data.per_issue_notes
        .filter((x: any) => typeof x === 'object' && x !== null)
        .map((x: any) => {
          const note: any = {
            issue_title: String(x.issue_title || '').trim(),
            issue_id: x.issue_id ? String(x.issue_id).trim() : undefined,
            note: x.note ? String(x.note).trim() : undefined
          }

          if (x.analysis && typeof x.analysis === 'object') {
            note.analysis = {
              root_cause: x.analysis.root_cause ? String(x.analysis.root_cause).trim() : undefined,
              user_impact: x.analysis.user_impact ? String(x.analysis.user_impact).trim() : undefined,
              fix_suggestion: x.analysis.fix_suggestion ? String(x.analysis.fix_suggestion).trim() : undefined,
              code_location: x.analysis.code_location ? String(x.analysis.code_location).trim() : undefined,
              similar_issues: x.analysis.similar_issues ? String(x.analysis.similar_issues).trim() : undefined
            }
          }

          return note
        })
        .filter((note: any) => note.issue_title && (note.note || note.analysis))
    }

    // root_cause 처리
    if (Array.isArray(data.root_cause)) {
      result.root_cause = data.root_cause.map(String).filter(Boolean)
    }

    // 폴백: per_issue_notes가 비었고 root_cause가 있으면 top1에 한 줄 붙여줌
    if (result.per_issue_notes && result.per_issue_notes.length === 0 &&
        result.root_cause && result.root_cause.length > 0 && topIssues.length > 0) {
      result.per_issue_notes = [{
        issue_title: topIssues[0].title || '(제목 없음)',
        note: result.root_cause[0]
      }]
    }

    return result
  }

  async generateWeeklyAdvice(
    reportData: WeeklyReportData,
    weekNumber: number,
    startDate: string,
    endDate: string,
    environment?: string
  ): Promise<WeeklyAIAnalysis> {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      // AI 없이 기본값 반환
      return this.getDefaultWeeklyAnalysis(reportData)
    }

    const maxRetries = 2
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const { default: OpenAI } = await import('openai')
        const client = new OpenAI({ apiKey })

        const prompt = this.buildWeeklyAnalysisPrompt(reportData, weekNumber, startDate, endDate, environment)

        const response = await client.chat.completions.create({
          model: 'gpt-4o-mini',
          temperature: 0.7,
          max_tokens: 4000,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' }
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
        return this.normalizeWeeklyAIAnalysis(data, reportData)
      } catch (error) {
        console.error(`Weekly AI analysis attempt ${attempt} failed:`, error)
        lastError = error as Error

        // 마지막 시도가 아니면 재시도
        if (attempt < maxRetries) {
          console.log(`Retrying... (${attempt}/${maxRetries})`)
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
          continue
        }
      }
    }

    // 모든 재시도 실패 시 fallback
    console.error(`Weekly AI analysis failed after ${maxRetries} attempts:`, lastError)
    return this.getDefaultWeeklyAnalysis(reportData)
  }

  private buildWeeklyAnalysisPrompt(
    reportData: WeeklyReportData,
    weekNumber: number,
    startDate: string,
    endDate: string,
    environment?: string
  ): string {
    const thisWeek = reportData.this_week
    const prevWeek = reportData.prev_week

    // 일평균 계산
    const thisDailyAvg = thisWeek?.events ? Math.round(thisWeek.events / 7) : 0
    const prevDailyAvg = prevWeek?.events ? Math.round(prevWeek.events / 7) : 0
    const dailyAvgChange = prevDailyAvg > 0 ? ((thisDailyAvg - prevDailyAvg) / prevDailyAvg * 100) : 0

    // CFR
    const thisCFR = thisWeek?.crash_free_sessions || 0
    const prevCFR = prevWeek?.crash_free_sessions || 0
    const cfrChange = thisCFR - prevCFR

    // Top 5 이슈 변화
    const top5Events = reportData.top5_events || []
    const prevTopEvents = reportData.prev_top_events || []

    // 간결한 이슈 정보
    const top5Compact = top5Events.slice(0, 5).map((issue, idx) => {
      const prevIssue = prevTopEvents.find(p => p.issue_id === issue.issue_id)
      const prevCount = prevIssue ? prevIssue.events : 0
      const change = prevCount > 0 ? ((issue.events - prevCount) / prevCount * 100).toFixed(1) : 'N/A'
      return {
        rank: idx + 1,
        title: issue.title,
        events: issue.events,
        prev_events: prevCount,
        change_pct: change
      }
    })

    const newIssues = reportData.new_issues || []
    const surgeIssues = reportData.surge_issues || []
    const releaseFixes = reportData.this_week_release_fixes || []

    return `당신은 Sentry 주간 리포트를 분석하는 회고 전문가입니다.
주간 리포트는 일간 리포트와 달리, "한 주를 돌아보고 다음 주를 준비"하는 데 집중합니다.

=== 분석 맥락 ===
- 대상 주차: ${weekNumber}주차 (${startDate} ~ ${endDate})
- 이번 주 전체 크래시 이벤트: ${thisWeek?.events || 0}건 (일평균 ${thisDailyAvg}건)
- 전주 전체 크래시 이벤트: ${prevWeek?.events || 0}건 (일평균 ${prevDailyAvg}건)
- 전주 대비 일평균 변화: ${dailyAvgChange > 0 ? '+' : ''}${dailyAvgChange.toFixed(1)}%
- 이번 주 Crash Free Rate: ${(thisCFR > 1 ? thisCFR : thisCFR * 100).toFixed(2)}%
- 전주 Crash Free Rate: ${(prevCFR > 1 ? prevCFR : prevCFR * 100).toFixed(2)}%
- CFR 변화: ${cfrChange > 0 ? '+' : ''}${cfrChange.toFixed(2)}%p
- 신규 이슈: ${newIssues.length}개
- 해결된 이슈: ${releaseFixes.reduce((sum, fix) => sum + (fix.disappeared?.length || 0), 0)}개
${environment ? `- 환경: ${environment}` : ''}

=== Top 5 이슈 변화 ===
${JSON.stringify(top5Compact, null, 2)}

${newIssues.length > 0 ? `=== 신규 이슈 (${newIssues.length}개) ===
${JSON.stringify(newIssues.slice(0, 5).map(i => ({
  title: i.title,
  event_count: i.event_count,
  first_seen: i.first_seen
})), null, 2)}
` : ''}

${surgeIssues.length > 0 ? `=== 급증 이슈 (${surgeIssues.length}개) ===
${JSON.stringify(surgeIssues.slice(0, 5).map(i => ({
  title: i.title,
  this_week: i.event_count,
  prev_week: i.prev_count,
  growth_multiplier: i.growth_multiplier
})), null, 2)}
` : ''}

${releaseFixes.length > 0 ? `=== 릴리즈로 해결된 이슈 ===
${JSON.stringify(releaseFixes.map(fix => ({
  release: fix.release,
  disappeared_count: fix.disappeared?.length || 0,
  decreased_count: fix.decreased?.length || 0
})), null, 2)}
` : ''}

=== 출력 형식 (JSON) ===
반드시 아래 형식의 순수 JSON만 출력하세요.

{
  "weekly_summary": {
    "level": "critical" | "warning" | "normal",
    "headline": "10자 이내 (예: '안정적', '주의 필요', '개선 중')",
    "daily_avg_crashes": {
      "current": ${thisDailyAvg},
      "previous": ${prevDailyAvg},
      "change_pct": ${dailyAvgChange.toFixed(1)}
    },
    "crash_free_rate": {
      "current": ${thisCFR > 1 ? thisCFR.toFixed(2) : (thisCFR * 100).toFixed(2)},
      "previous": ${prevCFR > 1 ? prevCFR.toFixed(2) : (prevCFR * 100).toFixed(2)},
      "change_pp": ${cfrChange.toFixed(2)}
    }
  },
  "key_changes": {
    "improvements": [
      {
        "title": "개선 항목 제목",
        "before": 전주 수치,
        "after": 이번주 수치,
        "reason": "개선 이유 (예: 'v1.2.3 배포로 MainActivity 버그 수정')",
        "impact": "영향 (예: '일평균 50건 감소, 사용자 경험 개선')"
      }
    ],
    "concerns": [
      {
        "title": "주목할 이슈 제목",
        "count": 이슈 발생 건수,
        "percentage": 전체 대비 비율 (숫자만),
        "context": "맥락 (예: '신규 발생', '전주 대비 2배 증가')",
        "action": "필요한 액션 (예: '즉시 원인 분석 필요')"
      }
    ]
  },
  "next_week_focus": [
    {
      "priority": 1,
      "title": "다음 주 집중할 액션 제목",
      "current_status": "현재 상태 (예: '일평균 150건 발생')",
      "goal": "목표 (예: '일평균 100건 이하로 감소')",
      "expected_impact": "기대 효과 (예: 'Crash Free Rate 0.5%p 향상')"
    }
  ],
  "next_week_goal": "다음 주 전체 목표 한 줄 (예: 'Crash Free Rate 99.5% 이상 유지 및 신규 이슈 조기 대응')"
}

=== 분석 가이드라인 ===

1. **weekly_summary.level** 판단:
   - critical: CFR < 99.0% 또는 일평균 크래시 50% 이상 증가
   - warning: CFR 99.0~99.5% 또는 일평균 크래시 20% 이상 증가
   - normal: 위 조건에 해당하지 않음

2. **key_changes.improvements**:
   - 전주 대비 개선된 점 (최대 3개)
   - 릴리즈로 해결된 이슈, 크래시 감소 등
   - 구체적 수치와 이유 포함

3. **key_changes.concerns**:
   - 주목해야 할 이슈 (최대 3개)
   - 신규 이슈, 급증 이슈, 지속되는 이슈
   - percentage는 숫자만 (예: 5.2)

4. **next_week_focus**:
   - 우선순위 순으로 최대 3개
   - 실행 가능하고 측정 가능한 목표 설정
   - 기대 효과는 정량적으로

5. **전체 톤**:
   - 단순 숫자 나열 금지 → 스토리로 풀어내기
   - "개선되었다"보다 "왜 개선되었는지" 설명
   - 실행 가능하고 구체적인 액션 제시
   - 모호한 표현 금지, 구체적 근거 제시`
  }

  private normalizeWeeklyAIAnalysis(data: any, reportData: WeeklyReportData): WeeklyAIAnalysis {
    const thisWeek = reportData.this_week
    const prevWeek = reportData.prev_week

    const thisDailyAvg = thisWeek?.events ? Math.round(thisWeek.events / 7) : 0
    const prevDailyAvg = prevWeek?.events ? Math.round(prevWeek.events / 7) : 0
    const dailyAvgChange = prevDailyAvg > 0 ? ((thisDailyAvg - prevDailyAvg) / prevDailyAvg * 100) : 0

    const thisCFR = thisWeek?.crash_free_sessions || 0
    const prevCFR = prevWeek?.crash_free_sessions || 0
    const cfrChange = thisCFR - prevCFR

    return {
      weekly_summary: {
        level: data.weekly_summary?.level || 'normal',
        headline: data.weekly_summary?.headline || '주간 요약',
        daily_avg_crashes: data.weekly_summary?.daily_avg_crashes || {
          current: thisDailyAvg,
          previous: prevDailyAvg,
          change_pct: dailyAvgChange
        },
        crash_free_rate: data.weekly_summary?.crash_free_rate || {
          current: thisCFR > 1 ? thisCFR : thisCFR * 100,
          previous: prevCFR > 1 ? prevCFR : prevCFR * 100,
          change_pp: cfrChange
        }
      },
      key_changes: {
        improvements: Array.isArray(data.key_changes?.improvements)
          ? data.key_changes.improvements.map((item: any) => ({
              title: String(item.title || ''),
              before: Number(item.before) || 0,
              after: Number(item.after) || 0,
              reason: item.reason ? String(item.reason) : undefined,
              impact: String(item.impact || '')
            }))
          : [],
        concerns: Array.isArray(data.key_changes?.concerns)
          ? data.key_changes.concerns.map((item: any) => ({
              title: String(item.title || ''),
              count: Number(item.count) || 0,
              percentage: Number(item.percentage) || 0,
              context: String(item.context || ''),
              action: String(item.action || '')
            }))
          : []
      },
      next_week_focus: Array.isArray(data.next_week_focus)
        ? data.next_week_focus.map((item: any) => ({
            priority: Number(item.priority) || 1,
            title: String(item.title || ''),
            current_status: String(item.current_status || ''),
            goal: String(item.goal || ''),
            expected_impact: String(item.expected_impact || '')
          }))
        : [],
      next_week_goal: String(data.next_week_goal || 'Crash Free Rate 99.5% 이상 유지')
    }
  }

  private getDefaultWeeklyAnalysis(reportData: WeeklyReportData): WeeklyAIAnalysis {
    const thisWeek = reportData.this_week
    const prevWeek = reportData.prev_week

    const thisDailyAvg = thisWeek?.events ? Math.round(thisWeek.events / 7) : 0
    const prevDailyAvg = prevWeek?.events ? Math.round(prevWeek.events / 7) : 0
    const dailyAvgChange = prevDailyAvg > 0 ? ((thisDailyAvg - prevDailyAvg) / prevDailyAvg * 100) : 0

    const thisCFR = thisWeek?.crash_free_sessions || 0
    const prevCFR = prevWeek?.crash_free_sessions || 0
    const cfrChange = thisCFR - prevCFR

    return {
      weekly_summary: {
        level: 'normal',
        headline: '주간 요약',
        daily_avg_crashes: {
          current: thisDailyAvg,
          previous: prevDailyAvg,
          change_pct: dailyAvgChange
        },
        crash_free_rate: {
          current: thisCFR > 1 ? thisCFR : thisCFR * 100,
          previous: prevCFR > 1 ? prevCFR : prevCFR * 100,
          change_pp: cfrChange
        }
      },
      key_changes: {
        improvements: [],
        concerns: []
      },
      next_week_focus: [],
      next_week_goal: 'Crash Free Rate 99.5% 이상 유지'
    }
  }
}

export const aiAnalysisService = new AIAnalysisService()
