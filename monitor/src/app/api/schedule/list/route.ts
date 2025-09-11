import { NextResponse } from 'next/server'
import { qstashService } from '@/lib/qstash-client'

export async function GET() {
  try {
    const schedules = await qstashService.listSchedules()
    return NextResponse.json({ success: true, schedules })
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 })
  }
}

