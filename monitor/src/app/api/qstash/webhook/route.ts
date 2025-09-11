import { NextRequest, NextResponse } from 'next/server'
import { qstashService } from '@/lib/qstash-client'

export async function POST(request: NextRequest) {
  console.log('[QStash Webhook] Received request')
  
  try {
    const signature = request.headers.get('upstash-signature')
    if (!signature) {
      console.error('[QStash Webhook] Missing signature')
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 })
    }

    const body = await request.text()
    
    // 서명 검증
    const isValid = await qstashService.verifySignature(signature, body)
    if (!isValid) {
      console.error('[QStash Webhook] Invalid signature')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    let payload
    try {
      payload = JSON.parse(body)
    } catch (error) {
      console.error('[QStash Webhook] Invalid JSON payload:', error)
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const { qstashJobId, triggeredBy } = payload
    console.log(`[QStash Webhook] Processing job: ${qstashJobId}, triggered by: ${triggeredBy}`)

    // 작업 유형 확인 및 처리
    if (qstashJobId?.includes('daily-report')) {
      console.log('[QStash Webhook] Processing daily report')
      return await processDailyReport()
    } else if (qstashJobId?.includes('weekly-report')) {
      console.log('[QStash Webhook] Processing weekly report')  
      return await processWeeklyReport()
    } else if (qstashJobId?.includes('monitor')) {
      console.log('[QStash Webhook] Processing monitor report')
      return await processMonitorReport()
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
      // 기존 daily report API 호출
      const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/monitor/tick?type=daily`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.CRON_SECRET || 'test-secret'}`
        },
        signal: AbortSignal.timeout(30000) // 30초 타임아웃
      })

      if (!response.ok) {
        throw new Error(`Daily report API failed: ${response.status}`)
      }

      const result = await response.json()
      console.log('[QStash Webhook] Daily report completed successfully')
      
      return NextResponse.json({
        success: true,
        type: 'daily-report',
        result,
        attempts: retryCount + 1
      })
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
      // 기존 weekly report API 호출
      const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/monitor/tick?type=weekly`, {
        method: 'POST', 
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.CRON_SECRET || 'test-secret'}`
        },
        signal: AbortSignal.timeout(30000) // 30초 타임아웃
      })

      if (!response.ok) {
        throw new Error(`Weekly report API failed: ${response.status}`)
      }

      const result = await response.json()
      console.log('[QStash Webhook] Weekly report completed successfully')
      
      return NextResponse.json({
        success: true,
        type: 'weekly-report', 
        result,
        attempts: retryCount + 1
      })
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

async function processMonitorReport() {
  let retryCount = 0
  const maxRetries = 2 // monitor는 재시도 횟수 줄임
  const retryDelay = 3000 // 3초

  while (retryCount < maxRetries) {
    try {
      // 기존 monitor API 호출
      const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/monitor/tick?type=monitor`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.CRON_SECRET || 'test-secret'}`
        },
        signal: AbortSignal.timeout(15000) // 15초 타임아웃 (monitor는 짧게)
      })

      if (!response.ok) {
        throw new Error(`Monitor API failed: ${response.status}`)
      }

      const result = await response.json()
      console.log('[QStash Webhook] Monitor report completed successfully')
      
      return NextResponse.json({
        success: true,
        type: 'monitor-report',
        result,
        attempts: retryCount + 1
      })
    } catch (error) {
      retryCount++
      console.error(`[QStash Webhook] Monitor report failed (attempt ${retryCount}):`, error)
      
      if (retryCount >= maxRetries) {
        throw new Error(`Monitor report failed after ${maxRetries} attempts: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
      
      // 재시도 전 대기
      await new Promise(resolve => setTimeout(resolve, retryDelay))
    }
  }
}