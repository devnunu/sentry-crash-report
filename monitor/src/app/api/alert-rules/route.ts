import {NextRequest, NextResponse} from 'next/server';
import {alertRulesDb} from '@/lib/database/alert-rules';
import {createApiError, createApiResponse, getErrorMessage} from '@/lib/utils';
import type {AlertCategory} from '@/lib/types/alert-rules';

export const runtime = 'nodejs';

// GET: 규칙 목록 조회
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category') as AlertCategory | null;

    const rules = await alertRulesDb.getAlertRules(category || undefined);

    return NextResponse.json(createApiResponse({ rules }));
  } catch (error) {
    console.error('[Alert Rules API] GET error:', error);
    return NextResponse.json(createApiError(getErrorMessage(error)), { status: 500 });
  }
}

// POST: 새 규칙 생성
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
561
    // 필수 필드 검증
    if (!body.name || !body.category || !body.severity) {
      return NextResponse.json(
        createApiError('name, category, severity는 필수입니다'),
        { status: 400 }
      );
    }

    if (!body.conditions || !Array.isArray(body.conditions) || body.conditions.length === 0) {
      return NextResponse.json(createApiError('최소 1개 이상의 조건이 필요합니다'), {
        status: 400
      });
    }

    const rule = await alertRulesDb.createAlertRule({
      name: body.name,
      category: body.category,
      severity: body.severity,
      enabled: body.enabled ?? true,
      conditionOperator: body.conditionOperator || 'OR',
      conditions: body.conditions,
      createdBy: body.createdBy || 'user'
    });

    return NextResponse.json(createApiResponse({ rule }), { status: 201 });
  } catch (error) {
    console.error('[Alert Rules API] POST error:', error);
    return NextResponse.json(createApiError(getErrorMessage(error)), { status: 500 });
  }
}
