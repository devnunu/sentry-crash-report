import {NextRequest, NextResponse} from 'next/server'
import {qstashService} from '@/lib/qstash-client'
import {reportsDb} from '@/lib/reports/database'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  console.log('[QStash Webhook] Received request')
  
  try {
    const signature = request.headers.get('upstash-signature')
    if (!signature) {
      console.error('[QStash Webhook] Missing signature')
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
    }

    const body = await request.text()
    
    // 서명 검증 (개발 환경에서는 스킵)
    if (process.env.NODE_ENV !== 'development' && signature !== 'dev-signature') {
      const url = request.url
      const method = 'POST'
      const isValid = await qstashService.verifySignature(signature, body, url, method)
      if (!isValid) {
        console.error('[QStash Webhook] Invalid signature')
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    } else if (process.env.NODE_ENV === 'development') {
      console.log('[QStash Webhook] Development mode - skipping signature verification')
    }

    let payload
    try {
      payload = JSON.parse(body)
    } catch (error) {
      console.error('[QStash Webhook] Invalid JSON payload:', error)
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const { qstashJobId, triggeredBy, monitorId, isTestMode, customInterval } = payload
    console.log(`[QStash Webhook] Processing job: ${qstashJobId}, triggered by: ${triggeredBy}`, monitorId ? `for monitor: ${monitorId}` : '', isTestMode ? `(test mode, ${customInterval}분 간격)` : '')

    // 작업 유형 확인 및 처리
    if (qstashJobId?.includes('daily-report')) {
      console.log('[QStash Webhook] Processing daily report')
      return await processDailyReport()
    } else if (qstashJobId?.includes('monitor-tick') || qstashJobId?.includes('test-monitor')) {
      console.log('[QStash Webhook] Processing monitor tick')
      return await processMonitorTick(monitorId, isTestMode, customInterval)
    } else {
      console.error(`[QStash Webhook] Unknown job type: ${qstashJobId}`)
      return NextResponse.json({ error: 'Unknown job type' }, { status: 400 })
    }

  } catch (error) {
    console.error('[QStash Webhook] Error processing webhook:', error)
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

function getBaseUrl() {
  // 1순위: NEXT_PUBLIC_APP_URL (명시적 설정)
  let baseUrl = process.env.NEXT_PUBLIC_APP_URL

  // localhost URL은 상용 환경에서 사용하지 않음
  if (baseUrl?.includes('localhost') && process.env.NODE_ENV === 'production') {
    baseUrl = undefined
  }

  // 2순위: VERCEL_URL (Vercel 자동 제공)
  if (!baseUrl && process.env.VERCEL_URL) {
    baseUrl = `https://${process.env.VERCEL_URL}`
  }

  // 3순위: localhost (개발 환경 폴백)
  if (!baseUrl) {
    baseUrl = 'http://localhost:3000'
  }

  return baseUrl
}

async function processDailyReport() {
  let retryCount = 0
  const maxRetries = 3
  const retryDelay = 5000 // 5초

  while (retryCount < maxRetries) {
    try {
      // Fetch settings to apply AI/test flags
      const settings = await reportsDb.getReportSettings('daily')
      const includeAI = settings?.ai_enabled ?? true
      const isTestMode = settings?.is_test_mode ?? false

      // 현재 요일 확인 (KST 기준)
      const now = new Date()
      const kstOffset = 9 * 60 // KST는 UTC+9
      const kstDate = new Date(now.getTime() + kstOffset * 60 * 1000)
      const dayOfWeek = kstDate.getUTCDay() // 0=일요일, 1=월요일, ...
      const dayMap = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
      const todayKey = dayMap[dayOfWeek]

      // slack_days에 오늘이 포함되는지 확인
      const slackDays = settings?.slack_days || []
      const shouldSendSlack = retryCount === 0 && slackDays.includes(todayKey)

      console.log(`[QStash Webhook] Daily report - Today: ${todayKey}, Slack days: ${slackDays.join(',')}, Send Slack: ${shouldSendSlack}`)

      // Run for both platforms
      const baseUrl = getBaseUrl()
      const platforms: Array<'android' | 'ios'> = ['android', 'ios']

      for (const platform of platforms) {
        console.log(`[QStash Webhook] Triggering daily generate for ${platform} -> ${baseUrl}/api/reports/daily/generate`)
        const response = await fetch(`${baseUrl}/api/reports/daily/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Trigger-Type': 'scheduled' },
          // 첫 시도 && 오늘이 slack_days에 포함된 경우에만 Slack 전송
          body: JSON.stringify({ sendSlack: shouldSendSlack, includeAI, isTestMode, platform }),
          signal: AbortSignal.timeout(120000)
        })
        if (!response.ok) {
          const text = await response.text().catch(() => '')
          throw new Error(`Daily report API failed for ${platform}: ${response.status} ${text?.slice(0,200)}`)
        }
        await response.json()
      }

      console.log('[QStash Webhook] Daily report completed successfully')
      return NextResponse.json({ success: true, type: 'daily-report', result: { platforms: ['android','ios'] }, attempts: retryCount + 1 })
    } catch (error) {
      retryCount++
      console.error(`[QStash Webhook] Daily report failed (attempt ${retryCount}):`, error)

      if (retryCount >= maxRetries) {
        throw new Error(`Daily report failed after ${maxRetries} attempts: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }

      // 재시도 전 대기
      await new Promise(resolve => setTimeout(resolve, retryDelay))
    }
  }
}

async function processMonitorTick(monitorId?: string, isTestMode?: boolean, customInterval?: number) {
  let retryCount = 0
  const maxRetries = 2
  const retryDelay = 3000 // 3초

  while (retryCount < maxRetries) {
    try {
      // 기존 monitor tick API 호출
      const url = `${getBaseUrl()}/api/monitor/tick`

      const requestBody = monitorId || isTestMode ? {
        monitorId,
        isTestMode,
        customInterval
      } : undefined

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.CRON_SECRET || 'test-secret'}`
        },
        body: requestBody ? JSON.stringify(requestBody) : undefined,
        signal: AbortSignal.timeout(15000) // 15초 타임아웃
      })

      if (!response.ok) {
        throw new Error(`Monitor tick API failed: ${response.status}`)
      }

      const result = await response.json()
      console.log(`[QStash Webhook] Monitor tick completed successfully${monitorId ? ` for monitor ${monitorId}` : ''}`)
      
      return NextResponse.json({
        success: true,
        type: 'monitor-tick',
        result,
        monitorId,
        attempts: retryCount + 1
      })
    } catch (error) {
      retryCount++
      console.error(`[QStash Webhook] Monitor tick failed (attempt ${retryCount}):`, error)
      
      if (retryCount >= maxRetries) {
        throw new Error(`Monitor tick failed after ${maxRetries} attempts: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
      
      // 재시도 전 대기
      await new Promise(resolve => setTimeout(resolve, retryDelay))
    }
  }
}
