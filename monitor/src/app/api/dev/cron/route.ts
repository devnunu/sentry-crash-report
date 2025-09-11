import { NextRequest, NextResponse } from 'next/server'

// 로컬 개발 크론은 비활성화 (QStash 사용)
export async function GET(request: NextRequest) {
  return NextResponse.json({
    success: true,
    data: {
      environment: process.env.NODE_ENV,
      cronService: { isRunning: false, tasksCount: 0 },
      message: 'Development cron is disabled. Use QStash schedules.'
    }
  })
}

export async function POST(request: NextRequest) {
  return NextResponse.json({
    success: false,
    error: 'Development cron is disabled. Use QStash schedules.'
  }, { status: 403 })
}
