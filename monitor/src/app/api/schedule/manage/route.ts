import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { qstashService } from '@/lib/qstash-client'
import type { WeekDay } from '@/lib/reports/types'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  try {
    const { reportType, scheduleDays, scheduleTime } = await request.json()
    
    console.log(`[Schedule API] Managing schedule for ${reportType}`)
    console.log(`  - Days: ${scheduleDays.join(', ')}`)
    console.log(`  - Time: ${scheduleTime}`)

    // 기존 설정 조회
    const { data: existingSettings } = await supabase
      .from('report_settings')
      .select('*')
      .eq('report_type', reportType)
      .single()

    // QStash 스케줄 업데이트
    const jobId = qstashService.getJobId(reportType as any)
    const cron = qstashService.buildCronExpression(scheduleDays, scheduleTime)
    
    const scheduleResult = await qstashService.updateSchedule({
      oldScheduleId: existingSettings?.qstash_schedule_id || undefined,
      jobId,
      endpoint: '/api/qstash/webhook',
      cron,
      body: { reportType }
    })

    // 데이터베이스 업데이트
    const { error: dbError } = await supabase
      .from('report_settings')
      .upsert({
        report_type: reportType,
        schedule_days: scheduleDays,
        schedule_time: scheduleTime,
        qstash_schedule_id: scheduleResult.scheduleId,
        updated_at: new Date().toISOString()
      }, { onConflict: 'report_type' })

    if (dbError) {
      console.error('[Schedule API] Database update failed:', dbError)
      // QStash 스케줄 롤백 시도
      try {
        await qstashService.deleteSchedule(scheduleResult.scheduleId)
      } catch (rollbackError) {
        console.error('[Schedule API] Rollback failed:', rollbackError)
      }
      throw new Error('Database update failed')
    }

    console.log(`[Schedule API] Schedule updated successfully: ${scheduleResult.scheduleId}`)
    
    return NextResponse.json({
      success: true,
      scheduleId: scheduleResult.scheduleId,
      cron,
      message: '스케줄이 성공적으로 업데이트되었습니다.'
    })

  } catch (error) {
    console.error('[Schedule API] Error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const reportType = searchParams.get('reportType')
    
    if (!reportType) {
      return NextResponse.json({ error: 'reportType is required' }, { status: 400 })
    }

    console.log(`[Schedule API] Deleting schedule for ${reportType}`)

    // 기존 설정 조회
    const { data: settings } = await supabase
      .from('report_settings')
      .select('qstash_schedule_id')
      .eq('report_type', reportType)
      .single()

    if (settings?.qstash_schedule_id) {
      // QStash 스케줄 삭제
      await qstashService.deleteSchedule(settings.qstash_schedule_id)
      
      // DB에서 스케줄 ID 제거
      const { error: dbError } = await supabase
        .from('report_settings')
        .update({ 
          qstash_schedule_id: null,
          updated_at: new Date().toISOString()
        })
        .eq('report_type', reportType)

      if (dbError) {
        console.error('[Schedule API] Database update failed:', dbError)
        throw new Error('Database update failed')
      }
    }

    console.log(`[Schedule API] Schedule deleted successfully for ${reportType}`)
    
    return NextResponse.json({
      success: true,
      message: '스케줄이 성공적으로 삭제되었습니다.'
    })

  } catch (error) {
    console.error('[Schedule API] Delete error:', error)
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}
