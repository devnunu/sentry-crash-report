import { NextRequest, NextResponse } from 'next/server'
import { createApiResponse, createApiError, getErrorMessage } from '@/lib/utils'

// This is a simple scheduler endpoint that can be called by external cron services
// like Vercel Cron, GitHub Actions, or external cron services like cron-job.org

export async function POST(request: NextRequest) {
  try {
    console.log('[Scheduler] Starting scheduled monitoring check...')
    
    // Verify the request is from a trusted source (optional)
    const authHeader = request.headers.get('authorization')
    const schedulerSecret = process.env.SCHEDULER_SECRET
    
    if (schedulerSecret && authHeader !== `Bearer ${schedulerSecret}`) {
      console.log('[Scheduler] Unauthorized scheduler request')
      return NextResponse.json(
        createApiError('Unauthorized'),
        { status: 401 }
      )
    }
    
    // Call the monitoring endpoint
    const monitoringUrl = `${request.nextUrl.origin}/api/sentry/monitor`
    
    const response = await fetch(monitoringUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'SentryScheduler/1.0'
      }
    })
    
    const data = await response.json()
    
    if (!response.ok) {
      throw new Error(`Monitoring API failed: ${response.status} - ${data.error || 'Unknown error'}`)
    }
    
    console.log(`[Scheduler] Scheduled monitoring completed successfully:`, {
      processed: data.data?.processed || 0,
      analyzed: data.data?.analyzed || 0
    })
    
    return NextResponse.json(createApiResponse({
      message: 'Scheduled monitoring completed',
      timestamp: new Date().toISOString(),
      results: data.data
    }))
    
  } catch (error) {
    console.error('[Scheduler] Scheduled monitoring failed:', error)
    
    return NextResponse.json(
      createApiError(getErrorMessage(error)),
      { status: 500 }
    )
  }
}

// GET: Check scheduler status and provide setup instructions
export async function GET(request: NextRequest) {
  try {
    const hasSecret = !!process.env.SCHEDULER_SECRET
    const schedulerUrl = `${request.nextUrl.origin}/api/sentry/schedule`
    
    return NextResponse.json(createApiResponse({
      schedulerUrl,
      hasSecret,
      setupInstructions: {
        vercel: {
          description: 'Vercel Cron으로 자동화하려면 vercel.json에 다음을 추가하세요:',
          config: {
            crons: [
              {
                path: '/api/sentry/schedule',
                schedule: '*/5 * * * *'
              }
            ]
          }
        },
        github: {
          description: 'GitHub Actions로 자동화하려면 .github/workflows/monitor.yml 파일을 생성하세요:',
          config: 'name: Sentry Monitor\non:\n  schedule:\n    - cron: "*/5 * * * *"\n  workflow_dispatch:\n\njobs:\n  monitor:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Call Sentry Monitor\n        run: |\n          curl -X POST "' + schedulerUrl + '" \\\n            -H "Authorization: Bearer ${{ secrets.SCHEDULER_SECRET }}" \\\n            -H "Content-Type: application/json"'
        },
        external: {
          description: '외부 크론 서비스 (cron-job.org, EasyCron 등)를 사용하는 경우:',
          method: 'POST',
          url: schedulerUrl,
          headers: hasSecret ? {
            'Authorization': 'Bearer YOUR_SCHEDULER_SECRET',
            'Content-Type': 'application/json'
          } : {
            'Content-Type': 'application/json'
          },
          interval: '*/5 * * * *'
        }
      },
      environment: {
        required: [
          'SENTRY_AUTH_TOKEN',
          'OPENAI_API_KEY',
          'NEXT_PUBLIC_SUPABASE_URL',
          'NEXT_PUBLIC_SUPABASE_ANON_KEY'
        ],
        optional: [
          'SCHEDULER_SECRET',
          'SLACK_WEBHOOK_URL',
          'SLACK_CHANNEL',
          'SLACK_MENTION_USERS'
        ]
      }
    }))
    
  } catch (error) {
    console.error('[Scheduler] Failed to get scheduler info:', error)
    return NextResponse.json(
      createApiError(getErrorMessage(error)),
      { status: 500 }
    )
  }
}