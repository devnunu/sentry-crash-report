import { NextRequest, NextResponse } from 'next/server'
import { reportsDb } from '@/lib/reports/database'
import { createApiResponse, createApiError, getErrorMessage } from '@/lib/utils'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const limitParam = searchParams.get('limit')
    const offsetParam = searchParams.get('offset')
    
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam), 1), 100) : 20
    const offset = offsetParam ? Math.max(parseInt(offsetParam), 0) : 0
    
    console.log(`[API] Fetching weekly report history (limit: ${limit}, offset: ${offset})`)
    
    const reports = await reportsDb.getReportExecutions('weekly', limit, offset)
    
    return NextResponse.json(
      createApiResponse({
        reports,
        total: reports.length,
        limit,
        offset
      })
    )
  } catch (error) {
    console.error('[API] Failed to fetch weekly report history:', error)
    
    return NextResponse.json(
      createApiError(getErrorMessage(error)),
      { status: 500 }
    )
  }
}