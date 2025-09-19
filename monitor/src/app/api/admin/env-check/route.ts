import { NextResponse } from 'next/server'

export async function GET() {
  try {
    // 환경 변수 체크 (민감한 정보는 실제 값 제공, 클라이언트에서 마스킹 처리)
    const envStatus = {
      // Supabase - Public keys는 그대로, Service key는 실제 값 제공
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || undefined,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || undefined,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || undefined,
      
      // Sentry
      SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN || undefined,
      SENTRY_ORG_SLUG: process.env.SENTRY_ORG_SLUG || undefined,
      
      // QStash
      QSTASH_TOKEN: process.env.QSTASH_TOKEN || undefined,
      QSTASH_CURRENT_SIGNING_KEY: process.env.QSTASH_CURRENT_SIGNING_KEY || undefined,
      QSTASH_NEXT_SIGNING_KEY: process.env.QSTASH_NEXT_SIGNING_KEY || undefined,
      
      // OpenAI
      OPENAI_API_KEY: process.env.OPENAI_API_KEY || undefined,
      
      // Slack
      SLACK_TEST_WEBHOOK_URL: process.env.SLACK_TEST_WEBHOOK_URL || undefined,
      
      // App URLs
      APP_BASE_URL: process.env.APP_BASE_URL || undefined,
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || undefined,
      VERCEL_URL: process.env.VERCEL_URL || undefined,
      
      // Others
      NODE_ENV: process.env.NODE_ENV || undefined,
      CRON_SECRET: process.env.CRON_SECRET || undefined,
    }

    return NextResponse.json(envStatus)
  } catch (error) {
    console.error('Environment check failed:', error)
    return NextResponse.json(
      { error: 'Failed to check environment variables' },
      { status: 500 }
    )
  }
}