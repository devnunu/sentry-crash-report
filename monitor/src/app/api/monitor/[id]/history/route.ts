import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/database'
import { createApiResponse, createApiError } from '@/lib/utils'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    if (!id) {
      return NextResponse.json(
        createApiError('모니터 ID가 필요합니다'),
        { status: 400 }
      )
    }

    // 모니터 히스토리 조회 (최대 100개)
    const histories = await db.getMonitorHistory(id, 100)

    return NextResponse.json(
      createApiResponse({
        histories,
        total: histories.length
      })
    )
  } catch (error) {
    console.error('Failed to fetch monitor histories:', error)
    return NextResponse.json(
      createApiError(error instanceof Error ? error.message : '히스토리 조회에 실패했습니다'),
      { status: 500 }
    )
  }
}

export const runtime = 'nodejs'
