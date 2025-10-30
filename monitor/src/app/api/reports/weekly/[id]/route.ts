import { NextRequest, NextResponse } from 'next/server'
import { reportsDb } from '@/lib/reports/database'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    if (!id) {
      return NextResponse.json(
        { error: 'Report ID is required' },
        { status: 400 }
      )
    }

    await reportsDb.deleteReportExecution(id)

    return NextResponse.json(
      { message: 'Report deleted successfully' },
      { status: 200 }
    )
  } catch (error) {
    console.error('Failed to delete weekly report:', error)
    return NextResponse.json(
      { error: 'Failed to delete report', details: (error as Error).message },
      { status: 500 }
    )
  }
}
