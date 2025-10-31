import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/database';
import { qstashService } from '@/lib/qstash-client';

export const runtime = 'nodejs';

// GET: 특정 모니터 조회
export async function GET(
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

    return NextResponse.json({ success: true, data: monitor });
  } catch (error) {
    console.error('[Version Monitor API] GET error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// DELETE: 모니터 중단
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

    // QStash 스케줄 삭제
    if (monitor.qstash_schedule_id) {
      try {
        await qstashService.deleteSchedule(monitor.qstash_schedule_id);
        console.log(`[Version Monitor API] Deleted QStash schedule: ${monitor.qstash_schedule_id}`);
      } catch (error) {
        console.error('[Version Monitor API] Failed to delete QStash schedule:', error);
        // QStash 삭제 실패해도 계속 진행
      }
    }

    // 모니터 상태를 'stopped'로 업데이트
    await db.updateMonitorStatus(id, 'stopped');

    console.log(`[Version Monitor API] Monitor stopped: ${id}`);

    return NextResponse.json({
      success: true,
      message: 'Monitor stopped successfully'
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
