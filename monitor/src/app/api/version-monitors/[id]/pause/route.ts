import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/database';
import { qstashService } from '@/lib/qstash-client';

export const runtime = 'nodejs';

// PUT: 모니터 일시정지
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const monitor = await db.getMonitorSession(id);

    if (!monitor) {
      return NextResponse.json(
        { success: false, error: 'Monitor not found' },
        { status: 404 }
      );
    }

    if (monitor.status !== 'active') {
      return NextResponse.json(
        { success: false, error: 'Monitor is not active' },
        { status: 400 }
      );
    }

    // QStash 스케줄 삭제 (일시정지)
    if (monitor.qstash_schedule_id) {
      try {
        await qstashService.deleteSchedule(monitor.qstash_schedule_id);
        console.log(`[Version Monitor API] Paused QStash schedule: ${monitor.qstash_schedule_id}`);
      } catch (error) {
        console.error('[Version Monitor API] Failed to pause QStash schedule:', error);
        // QStash 삭제 실패해도 계속 진행
      }
    }

    // 모니터 상태를 'paused'로 업데이트 (paused 상태가 스키마에 없으면 stopped 사용)
    // 현재 스키마는 active, stopped, expired만 지원하므로 metadata에 저장
    await db.updateMonitorMetadata(id, {
      ...monitor.metadata,
      paused: true,
      pausedAt: new Date().toISOString()
    });

    console.log(`[Version Monitor API] Monitor paused: ${id}`);

    return NextResponse.json({
      success: true,
      message: 'Monitor paused successfully'
    });
  } catch (error) {
    console.error('[Version Monitor API] PUT error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// DELETE: 일시정지 해제 (재시작)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const monitor = await db.getMonitorSession(id);

    if (!monitor) {
      return NextResponse.json(
        { success: false, error: 'Monitor not found' },
        { status: 404 }
      );
    }

    const metadata = monitor.metadata || {};
    if (!metadata.paused) {
      return NextResponse.json(
        { success: false, error: 'Monitor is not paused' },
        { status: 400 }
      );
    }

    // metadata에서 paused 플래그 제거
    const { paused, pausedAt, ...restMetadata } = metadata;
    await db.updateMonitorMetadata(id, restMetadata);

    // QStash 스케줄 재등록
    const intervalMinutes = monitor.custom_interval_minutes || 60;
    const jobId = `monitor-${monitor.id}`;
    const cron = `*/${intervalMinutes} * * * *`; // 매 N분마다

    const scheduleResult = await qstashService.scheduleJob({
      jobId,
      endpoint: '/api/qstash/webhook',
      cron,
      body: {
        monitorId: monitor.id,
        isTestMode: monitor.is_test_mode
      }
    });

    // QStash 스케줄 ID 업데이트
    await db.updateMonitorQStashScheduleId(id, scheduleResult.scheduleId);

    console.log(`[Version Monitor API] Monitor resumed: ${id}`);

    return NextResponse.json({
      success: true,
      message: 'Monitor resumed successfully'
    });
  } catch (error) {
    console.error('[Version Monitor API] DELETE error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
