import { NextRequest, NextResponse } from 'next/server';
import { alertRulesDb } from '@/lib/database/alert-rules';
import { createApiResponse, createApiError, getErrorMessage } from '@/lib/utils';

export const runtime = 'nodejs';

// PATCH: 규칙 활성화/비활성화
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json(createApiError('enabled 필드가 필요합니다'), { status: 400 });
    }

    await alertRulesDb.toggleAlertRule(id, body.enabled);

    return NextResponse.json(
      createApiResponse({
        message: `규칙이 ${body.enabled ? '활성화' : '비활성화'}되었습니다`
      })
    );
  } catch (error) {
    console.error('[Alert Rules API] PATCH toggle error:', error);
    return NextResponse.json(createApiError(getErrorMessage(error)), { status: 500 });
  }
}
