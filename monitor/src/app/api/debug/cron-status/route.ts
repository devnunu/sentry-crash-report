import { NextRequest, NextResponse } from 'next/server'
import { reportsDb } from '@/lib/reports/database'
import type { WeekDay } from '@/lib/reports/types'
import { formatKST } from '@/lib/utils'

export async function GET(request: NextRequest) {
  try {
    // KST 시간 계산
    const now = new Date()
    const kstTimeStr = now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' })
    const kstTime = new Date(kstTimeStr)
    const dayOfWeek = kstTime.getDay()
    const currentTime = `${kstTime.getHours().toString().padStart(2, '0')}:${kstTime.getMinutes().toString().padStart(2, '0')}`
    const dayMapping = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
    const todayKey = dayMapping[dayOfWeek] as WeekDay

    // 일간 리포트 설정 확인
    const dailySettings = await reportsDb.getReportSettings('daily')
    let dailyScheduleTime = dailySettings?.schedule_time || '09:00'
    if (dailyScheduleTime.length === 8) {
      dailyScheduleTime = dailyScheduleTime.substring(0, 5)
    }

    // 주간 리포트 설정 확인
    const weeklySettings = await reportsDb.getReportSettings('weekly')
    let weeklyScheduleTime = weeklySettings?.schedule_time || '09:00'
    if (weeklyScheduleTime.length === 8) {
      weeklyScheduleTime = weeklyScheduleTime.substring(0, 5)
    }

    // 최근 실행 기록 확인
    const recentDaily = await reportsDb.getReportExecutions('daily', 3)
    const recentWeekly = await reportsDb.getReportExecutions('weekly', 3)

    return NextResponse.json({
      success: true,
      data: {
        currentTime: {
          utc: now.toISOString(),
          kst: kstTime.toISOString(),
          time: currentTime,
          day: todayKey
        },
        dailyReport: {
          enabled: dailySettings?.auto_enabled || false,
          scheduleTime: dailyScheduleTime,
          scheduleDays: dailySettings?.schedule_days || ['mon', 'tue', 'wed', 'thu', 'fri'],
          shouldRunToday: (dailySettings?.schedule_days || ['mon', 'tue', 'wed', 'thu', 'fri']).includes(todayKey),
          timeMatch: currentTime === dailyScheduleTime,
          recentExecutions: recentDaily.map(r => ({
            id: r.id,
            triggerType: r.trigger_type,
            status: r.status,
            createdAt: r.created_at,
            createdAtKST: formatKST(r.created_at)
          }))
        },
        weeklyReport: {
          enabled: weeklySettings?.auto_enabled || false,
          scheduleTime: weeklyScheduleTime,
          scheduleDays: weeklySettings?.schedule_days || ['mon'],
          shouldRunToday: (weeklySettings?.schedule_days || ['mon']).includes(todayKey),
          timeMatch: currentTime === weeklyScheduleTime,
          recentExecutions: recentWeekly.map(r => ({
            id: r.id,
            triggerType: r.trigger_type,
            status: r.status,
            createdAt: r.created_at,
            createdAtKST: formatKST(r.created_at)
          }))
        }
      }
    })
  } catch (error) {
    console.error('Debug status error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '알 수 없는 오류'
    }, { status: 500 })
  }
}
