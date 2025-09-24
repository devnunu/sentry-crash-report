import { NextRequest, NextResponse } from 'next/server'
import { createApiResponse, createApiError, getErrorMessage } from '@/lib/utils'
import { fetchSentryIssueData } from '@/lib/sentry-api'
import { performAIAnalysis, type Platform } from '@/lib/ai-analysis'
import { sendNotification } from '@/lib/notifications'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

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

// Sentry webhook signature verification
function verifySignature(payload: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false
  
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')
  
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  )
}

interface SentryWebhookPayload {
  action: string
  installation: {
    uuid: string
  }
  data: {
    issue: {
      id: string
      shortId: string
      title: string
      culprit: string
      permalink: string
      level: string
      status: string
      statusDetails: any
      type: string
      metadata: {
        value?: string
        type?: string
        filename?: string
        function?: string
      }
      numComments: number
      assignedTo: any
      logger: string
      annotations: string[]
      platform: string
      count: string
      userCount: number
      firstSeen: string
      lastSeen: string
      shareId: string
      project: {
        id: string
        name: string
        slug: string
        platform: string
      }
    }
    event?: {
      id: string
      eventID: string
      groupID: string
      title: string
      message: string
      type: string
      metadata: any
      tags: Array<{ key: string; value: string }>
      dateCreated: string
      user: any
      entries: Array<{ type: string; data: any }>
      context: any
    }
  }
}

// 웹훅 처리 로그 저장
async function saveWebhookLog(payload: SentryWebhookPayload, success: boolean, error?: string) {
  try {
    await supabase
      .from('webhook_logs')
      .insert({
        webhook_type: 'sentry',
        action: payload.action,
        issue_id: payload.data.issue?.id,
        issue_short_id: payload.data.issue?.shortId,
        issue_title: payload.data.issue?.title,
        project_slug: payload.data.issue?.project?.slug,
        success,
        error_message: error,
        payload: payload,
        received_at: new Date().toISOString()
      })
  } catch (logError) {
    console.error('[Webhook] Failed to save webhook log:', logError)
  }
}

// 이슈 자동 분석 및 저장
async function processIssueAutomatically(issue: SentryWebhookPayload['data']['issue']) {
  try {
    console.log(`[Webhook] Processing issue automatically: ${issue.shortId}`)
    
    // 이미 분석된 이슈인지 확인
    const { data: existingAnalysis } = await supabase
      .from('sentry_issue_analyses')
      .select('issue_id')
      .eq('issue_id', issue.id)
      .single()
    
    if (existingAnalysis) {
      console.log(`[Webhook] Issue ${issue.shortId} already analyzed, skipping`)
      return { analyzed: false, reason: 'Already analyzed' }
    }
    
    // Critical/High 레벨 이슈만 자동 분석 (리소스 절약)
    if (issue.level !== 'error' && issue.level !== 'fatal') {
      console.log(`[Webhook] Issue ${issue.shortId} level is ${issue.level}, skipping auto-analysis`)
      return { analyzed: false, reason: 'Level too low for auto-analysis' }
    }
    
    // Sentry에서 상세 데이터 가져오기
    const issueData = await fetchSentryIssueData(issue.id, issue.shortId)
    
    // 프로젝트 슬러그에서 플랫폼 감지
    const detectedPlatform = detectPlatformFromProject(issue.project.slug)
    
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
        analysis_version: 'v2_enhanced_webhook',
        is_monitored: true,
        auto_analyzed: true,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'issue_id'
      })
    
    if (error) {
      throw error
    }
    
    console.log(`[Webhook] Successfully analyzed issue: ${issue.shortId}`)
    
    // Send notifications
    try {
      const notificationResults = await sendNotification({
        issueId: issue.id,
        shortId: issue.shortId,
        title: issue.title,
        severity: analysis.severity as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW',
        category: analysis.category,
        sentryUrl: issueData.sentryUrl,
        analysis
      })
      
      console.log(`[Webhook] Notifications sent - Slack: ${notificationResults.slack}, Email: ${notificationResults.email}`)
    } catch (notificationError) {
      console.error(`[Webhook] Failed to send notifications for issue ${issue.shortId}:`, notificationError)
    }
    
    return {
      analyzed: true,
      issueId: issue.id,
      shortId: issue.shortId,
      severity: analysis.severity,
      category: analysis.category
    }
    
  } catch (error) {
    console.error(`[Webhook] Failed to process issue ${issue.shortId}:`, error)
    return {
      analyzed: false,
      error: getErrorMessage(error)
    }
  }
}

// POST: Sentry 웹훅 처리
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    const signature = request.headers.get('sentry-hook-signature')
    const webhookSecret = process.env.SENTRY_WEBHOOK_SECRET
    
    // 시그니처 검증 (프로덕션에서는 필수)
    if (webhookSecret && signature) {
      const isValid = verifySignature(rawBody, signature, webhookSecret)
      if (!isValid) {
        console.error('[Webhook] Invalid signature')
        return NextResponse.json(
          createApiError('Invalid signature'),
          { status: 401 }
        )
      }
    }
    
    const payload: SentryWebhookPayload = JSON.parse(rawBody)
    
    console.log(`[Webhook] Received Sentry webhook: ${payload.action}`)
    
    // 지원하는 액션만 처리
    const supportedActions = ['issue.created', 'issue.resolved', 'issue.assigned']
    if (!supportedActions.includes(payload.action)) {
      console.log(`[Webhook] Unsupported action: ${payload.action}`)
      await saveWebhookLog(payload, true, 'Unsupported action')
      return NextResponse.json(createApiResponse({ 
        message: 'Webhook received but action not supported',
        action: payload.action 
      }))
    }
    
    // 지원 플랫폼 프로젝트 확인
    const projectSlug = payload.data.issue?.project?.slug
    const supportedProjects = ['finda-ios', 'finda-android', 'finda-web', 'finda-backend', 'finda-api']
    
    if (!projectSlug || !supportedProjects.some(project => projectSlug.includes(project.replace('finda-', '')))) {
      console.log(`[Webhook] Skipping unsupported project: ${projectSlug}`)
      await saveWebhookLog(payload, true, 'Non-target project')
      return NextResponse.json(createApiResponse({ 
        message: 'Webhook received but project not monitored',
        project: projectSlug 
      }))
    }
    
    console.log(`[Webhook] Processing ${detectPlatformFromProject(projectSlug)} project: ${projectSlug}`)
    
    let processResult = null
    
    // 새로운 이슈가 생성된 경우 자동 분석
    if (payload.action === 'issue.created' && payload.data.issue) {
      processResult = await processIssueAutomatically(payload.data.issue)
    }
    
    // 웹훅 처리 성공 로그 저장
    await saveWebhookLog(payload, true)
    
    const response = {
      message: 'Webhook processed successfully',
      action: payload.action,
      issue: payload.data.issue ? {
        id: payload.data.issue.id,
        shortId: payload.data.issue.shortId,
        title: payload.data.issue.title,
        level: payload.data.issue.level,
        project: payload.data.issue.project.slug
      } : null,
      processing: processResult
    }
    
    console.log('[Webhook] Successfully processed webhook:', response)
    
    return NextResponse.json(createApiResponse(response))
    
  } catch (error) {
    console.error('[Webhook] Failed to process webhook:', error)
    
    try {
      const payload = JSON.parse(await request.text())
      await saveWebhookLog(payload, false, getErrorMessage(error))
    } catch (parseError) {
      console.error('[Webhook] Failed to parse payload for error logging:', parseError)
    }
    
    return NextResponse.json(
      createApiError(getErrorMessage(error)),
      { status: 500 }
    )
  }
}

// GET: 웹훅 설정 및 로그 조회
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '10')
    
    // 최근 웹훅 로그 조회
    const { data: webhookLogs, error } = await supabase
      .from('webhook_logs')
      .select('*')
      .eq('webhook_type', 'sentry')
      .order('received_at', { ascending: false })
      .limit(limit)
    
    if (error) {
      throw error
    }
    
    // 웹훅 통계
    const { data: stats } = await supabase
      .from('webhook_logs')
      .select('success, action')
      .eq('webhook_type', 'sentry')
      .gte('received_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // 최근 24시간
    
    const statistics = {
      total: stats?.length || 0,
      successful: stats?.filter(s => s.success).length || 0,
      failed: stats?.filter(s => !s.success).length || 0,
      byAction: stats?.reduce((acc, stat) => {
        acc[stat.action] = (acc[stat.action] || 0) + 1
        return acc
      }, {} as Record<string, number>) || {}
    }
    
    return NextResponse.json(createApiResponse({
      webhookUrl: `${request.nextUrl.origin}/api/sentry/webhook`,
      webhookSecret: process.env.SENTRY_WEBHOOK_SECRET ? 'configured' : 'not configured',
      statistics,
      recentLogs: webhookLogs || []
    }))
    
  } catch (error) {
    console.error('[Webhook] Failed to get webhook info:', error)
    return NextResponse.json(
      createApiError(getErrorMessage(error)),
      { status: 500 }
    )
  }
}