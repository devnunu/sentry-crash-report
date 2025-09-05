import { NextResponse } from 'next/server'
import { db } from '@/lib/database'
import { SchedulerService, formatScheduleInfo, getScheduleSummary } from '@/lib/scheduler'
import { createApiResponse, createApiError, getErrorMessage } from '@/lib/utils'

export async function GET() {
  try {
    // 활성 모니터들 조회
    const activeMonitors = await db.getActiveMonitorSessions()
    
    if (activeMonitors.length === 0) {
      return NextResponse.json(
        createApiResponse({
          message: '활성 모니터가 없습니다.',
          schedules: [],
          summary: {
            total: 0,
            toExecute: 0,
            waiting: 0,
            intervals: { '30m': 0, '1h': 0 }
          }
        })
      )
    }
    
    // 각 모니터의 스케줄 상태 분석
    const scheduleConfigs = await Promise.all(
      activeMonitors.map(async (monitor) => {
        // 마지막 실행 시간 조회
        const lastHistory = await db.getLastMonitorHistory(monitor.id)
        
        return SchedulerService.analyzeSchedule(
          monitor.id,
          monitor.platform,
          monitor.base_release,
          monitor.started_at,
          lastHistory?.executed_at
        )
      })
    )
    
    // 스케줄 요약 정보 생성
    const summary = getScheduleSummary(scheduleConfigs)
    
    // 상세 정보 포맷팅
    const scheduleDetails = scheduleConfigs.map(config => ({
      ...config,
      formatted: formatScheduleInfo(config),
      nextExecution: SchedulerService.getNextExecutionTime(
        config.startedAt,
        // 마지막 실행 시간을 위해 다시 조회 (최적화 여지 있음)
        activeMonitors.find(m => m.id === config.monitorId)?.created_at
      )
    }))
    
    return NextResponse.json(
      createApiResponse({
        message: `${scheduleConfigs.length}개의 활성 모니터 스케줄 정보`,
        schedules: scheduleDetails,
        summary,
        timestamp: new Date().toISOString()
      })
    )
    
  } catch (error) {
    return NextResponse.json(
      createApiError(getErrorMessage(error)),
      { status: 500 }
    )
  }
}