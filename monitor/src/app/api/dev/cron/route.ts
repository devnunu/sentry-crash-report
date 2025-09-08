import { NextRequest, NextResponse } from 'next/server'
import { devCronService } from '@/lib/dev-cron'
import { getDevServicesStatus } from '@/lib/server-startup'

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({
      success: false,
      error: '개발 모드에서만 사용 가능합니다.'
    }, { status: 403 })
  }

  // 자동으로 cron 서비스 시작 (아직 실행 중이 아니라면)
  if (!devCronService.getStatus().isRunning) {
    console.log('🚀 Auto-starting development cron service...')
    devCronService.start()
  }

  const status = getDevServicesStatus()
  
  return NextResponse.json({
    success: true,
    data: {
      ...status,
      cronService: devCronService.getStatus(), // 실제 cron 상태로 업데이트
      message: 'Development cron service status',
      autoStarted: !devCronService.getStatus().isRunning ? false : true
    }
  })
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({
      success: false,
      error: '개발 모드에서만 사용 가능합니다.'
    }, { status: 403 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const { action, type } = body

    switch (action) {
      case 'start':
        devCronService.start()
        return NextResponse.json({
          success: true,
          data: {
            message: 'Development cron service started',
            status: devCronService.getStatus()
          }
        })

      case 'stop':
        devCronService.stop()
        return NextResponse.json({
          success: true,
          data: {
            message: 'Development cron service stopped',
            status: devCronService.getStatus()
          }
        })

      case 'trigger':
        if (type === 'daily') {
          const result = await devCronService.triggerDaily()
          return NextResponse.json({
            success: true,
            data: {
              message: 'Daily report triggered manually',
              result
            }
          })
        } else if (type === 'weekly') {
          const result = await devCronService.triggerWeekly()
          return NextResponse.json({
            success: true,
            data: {
              message: 'Weekly report triggered manually',
              result
            }
          })
        } else {
          return NextResponse.json({
            success: false,
            error: 'Invalid trigger type. Use "daily" or "weekly"'
          }, { status: 400 })
        }

      case 'status':
      default:
        return NextResponse.json({
          success: true,
          data: {
            message: 'Development cron service status',
            status: devCronService.getStatus()
          }
        })
    }
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 })
  }
}