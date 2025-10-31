import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/database';

export const runtime = 'nodejs';

// GET: 모니터 히스토리 조회
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const monitor = await db.getMonitorSession(id);

    if (!monitor) {
      return NextResponse.json(
        { success: false, error: 'Monitor not found' },
        { status: 404 }
      );
    }

    const history = await db.getMonitorHistory(id, limit);

    return NextResponse.json({
      success: true,
      data: {
        monitor,
        history
      }
    });
  } catch (error) {
    console.error('[Version Monitor History API] GET error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
