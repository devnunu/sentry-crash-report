import { NextRequest, NextResponse } from 'next/server';
import { alertRulesDb } from '@/lib/database/alert-rules';
import { createApiResponse, createApiError, getErrorMessage } from '@/lib/utils';

export const runtime = 'nodejs';

// GET: 규칙 단일 조회
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const rule = await alertRulesDb.getAlertRule(id);

    if (!rule) {
      return NextResponse.json(createApiError('규칙을 찾을 수 없습니다'), { status: 404 });
    }

    return NextResponse.json(createApiResponse({ rule }));
  } catch (error) {
    console.error('[Alert Rules API] GET error:', error);
    return NextResponse.json(createApiError(getErrorMessage(error)), { status: 500 });
  }
}

// PUT: 규칙 수정
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const rule = await alertRulesDb.updateAlertRule(id, {
      name: body.name,
      enabled: body.enabled,
      conditionOperator: body.conditionOperator,
      conditions: body.conditions
    });

    return NextResponse.json(createApiResponse({ rule }));
  } catch (error) {
    console.error('[Alert Rules API] PUT error:', error);
    return NextResponse.json(createApiError(getErrorMessage(error)), { status: 500 });
  }
}

// DELETE: 규칙 삭제
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    await alertRulesDb.deleteAlertRule(id);

    return NextResponse.json(createApiResponse({ message: '규칙이 삭제되었습니다' }));
  } catch (error) {
    console.error('[Alert Rules API] DELETE error:', error);
    return NextResponse.json(createApiError(getErrorMessage(error)), { status: 500 });
  }
}
