import {NextRequest, NextResponse} from 'next/server'
import {reportsDb} from '@/lib/reports/database'
import {createApiError, createApiResponse} from '@/lib/utils'
import {getEventDetails, getLatestEventIdForIssue} from '@/lib/sentry-issues'
import OpenAI from 'openai'

function hashPrompt(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return String(h)
}

export const runtime = 'nodejs'

export async function GET(request: NextRequest, context: { params: Promise<{ issueId: string }> }) {
  try {
    const { issueId } = await context.params
    const { searchParams } = new URL(request.url)
    const platform = searchParams.get('platform') as 'android'|'ios'
    const reportType = searchParams.get('type') as 'daily'
    const dateKey = searchParams.get('dateKey') as string
    if (!platform || !reportType || !dateKey) {
      return NextResponse.json(createApiError('platform, type, dateKey required'), { status: 400 })
    }
    console.log(`[IssueAnalysis][GET] issueId=${issueId} platform=${platform} type=${reportType} dateKey=${dateKey}`)
    const existing = await reportsDb.getIssueAnalysis(platform, issueId, reportType, dateKey)
    if (existing) {
      console.log(`[IssueAnalysis][GET] cache hit: id=${existing.id}`)
    } else {
      console.log(`[IssueAnalysis][GET] cache miss`)
    }
    return NextResponse.json(createApiResponse({ analysis: existing?.analysis || null }))
  } catch (e:any) {
    console.error('[IssueAnalysis][GET] error:', e)
    return NextResponse.json(createApiError(e.message || 'failed'), { status: 500 })
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ issueId: string }> }) {
  try {
    const { issueId } = await context.params
    const body = await request.json().catch(() => ({}))
    const platform = body.platform as 'android'|'ios'
    const reportType = body.type as 'daily'
    const dateKey = body.dateKey as string
    const force = !!body.force
    if (!platform || !reportType || !dateKey) {
      return NextResponse.json(createApiError('platform, type, dateKey required'), { status: 400 })
    }
    console.log(`[IssueAnalysis][POST] issueId=${issueId} platform=${platform} type=${reportType} dateKey=${dateKey} force=${force}`)
    if (!force) {
      const cached = await reportsDb.getIssueAnalysis(platform, issueId, reportType, dateKey)
      if (cached?.analysis) return NextResponse.json(createApiResponse({ analysis: cached.analysis, cached: true }))
    }

    // Fetch latest event details for the issue
    console.log('[IssueAnalysis] resolving latest event id...')
    const eventId = await getLatestEventIdForIssue(issueId, platform)
    console.log(`[IssueAnalysis] latest event id: ${eventId}`)
    if (!eventId) {
      return NextResponse.json(createApiError('No events for issue'), { status: 404 })
    }
    const details = await getEventDetails(eventId, platform)
    console.log(`[IssueAnalysis] fetched event details: eventId=${details.id}`)
    const stack = (details.stacktraceFrames || []).slice(-8).reverse() // top frames
    const breadcrumbs = (details.breadcrumbs || []).slice(-20)

    let analysis: any = { summary: '분석 실패', notes: [] }
    const rawKey = process.env.OPENAI_API_KEY
    const apiKey = (rawKey || '').trim()
    console.log(`[IssueAnalysis] OPENAI_API_KEY present=${apiKey.length>0} length=${apiKey.length}`)
    if (apiKey.length > 0) {
      const client = new OpenAI({ apiKey })
      const prompt = `당신은 모바일 앱 크래시 분석가입니다. 주어진 이슈의 최근 이벤트 정보를 바탕으로 원인을 분석하고 개선책을 제시하세요.\n\n` +
        `플랫폼: ${platform}\n리포트: ${reportType}\n기간키: ${dateKey}\n이슈ID: ${issueId}\n제목: ${details.title || ''}\n\n` +
        `스택프레임(상위 8):\n${stack.map((f:any)=>`- ${f.module || f.filename || ''}:${f.lineno || ''} in ${f.function || ''}`).join('\n')}\n\n` +
        `최근 브레드크럼(최대 20):\n${breadcrumbs.map((b:any)=>`- [${b.category || ''}] ${b.message || b.type || ''}`).join('\n')}\n\n` +
        `요청사항:\n1) 원인 요약(핵심 2~3줄)\n2) 유력한 원인 후보(코드/라이브러리/OS 등)\n3) 즉시 조치 및 근본 해결안\n4) 재발 방지 모니터링 포인트\n`
      const resp = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: '간결하고 실무적으로 응답하세요.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
      })
      const content = resp.choices[0]?.message?.content || ''
      analysis = { summary: content, context: { stack, breadcrumbs, eventId: details.id } }
    } else {
      analysis = { summary: 'OPENAI_API_KEY 미설정으로 간단 컨텍스트만 저장합니다.', context: { stack, breadcrumbs, eventId: details.id } }
    }

    const digest = hashPrompt(JSON.stringify({ platform, reportType, dateKey, issue: issueId, eventId: details.id }))
    const saved = await reportsDb.upsertIssueAnalysis(platform, issueId, reportType, dateKey, analysis, digest)
    console.log(`[IssueAnalysis] analysis saved: id=${saved.id}`)
    return NextResponse.json(createApiResponse({ analysis: saved.analysis, cached: false }))
  } catch (error) {
    // 에러 본문을 그대로 전달하여 디버깅 용이
    const message = error instanceof Error ? error.message : String(error)
    console.error('[IssueAnalysis][POST] error:', error)
    return NextResponse.json(createApiError(message), { status: 500 })
  }
}
