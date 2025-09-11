import { NextRequest, NextResponse } from 'next/server'
import { qstashService } from '@/lib/qstash-client'
import { reportsDb } from '@/lib/reports/database'

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
      const isValid = await qstashService.verifySignature(signature, body)
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

    const { qstashJobId, triggeredBy, monitorId } = payload
    console.log(`[QStash Webhook] Processing job: ${qstashJobId}, triggered by: ${triggeredBy}`, monitorId ? `for monitor: ${monitorId}` : '')

    // 작업 유형 확인 및 처리
    if (qstashJobId?.includes('daily-report')) {
      console.log('[QStash Webhook] Processing daily report')
      return await processDailyReport()
    } else if (qstashJobId?.includes('weekly-report')) {
      console.log('[QStash Webhook] Processing weekly report')  
      return await processWeeklyReport()
    } else if (qstashJobId?.includes('monitor-tick')) {
      console.log('[QStash Webhook] Processing monitor tick')
      return await processMonitorTick(monitorId)
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

      // Run for both platforms
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      const platforms: Array<'android' | 'ios'> = ['android', 'ios']

      for (const platform of platforms) {
        const response = await fetch(`${baseUrl}/api/reports/daily/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sendSlack: true, includeAI, isTestMode, platform }),
          signal: AbortSignal.timeout(60000)
        })
        if (!response.ok) {
          throw new Error(`Daily report API failed for ${platform}: ${response.status}`)
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

async function processWeeklyReport() {
  let retryCount = 0
  const maxRetries = 3
  const retryDelay = 5000 // 5초

  while (retryCount < maxRetries) {
    try {
      // Fetch settings to apply AI/test flags
      const settings = await reportsDb.getReportSettings('weekly')
      const includeAI = settings?.ai_enabled ?? true
      const isTestMode = settings?.is_test_mode ?? false

      // Run for both platforms
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      const platforms: Array<'android' | 'ios'> = ['android', 'ios']

      for (const platform of platforms) {
        const response = await fetch(`${baseUrl}/api/reports/weekly/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sendSlack: true, includeAI, isTestMode, platform }),
          signal: AbortSignal.timeout(90000)
        })
        if (!response.ok) {
          throw new Error(`Weekly report API failed for ${platform}: ${response.status}`)
        }
        await response.json()
      }

      console.log('[QStash Webhook] Weekly report completed successfully')
      return NextResponse.json({ success: true, type: 'weekly-report', result: { platforms: ['android','ios'] }, attempts: retryCount + 1 })
    } catch (error) {
      retryCount++
      console.error(`[QStash Webhook] Weekly report failed (attempt ${retryCount}):`, error)
      
      if (retryCount >= maxRetries) {
        throw new Error(`Weekly report failed after ${maxRetries} attempts: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
      
      // 재시도 전 대기
      await new Promise(resolve => setTimeout(resolve, retryDelay))
    }
  }
}

async function processMonitorTick(monitorId?: string) {
  let retryCount = 0
  const maxRetries = 2
  const retryDelay = 3000 // 3초

  while (retryCount < maxRetries) {
    try {
      // 기존 monitor tick API 호출
      const url = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/monitor/tick`
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.CRON_SECRET || 'test-secret'}`
        },
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
