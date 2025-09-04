// app/api/monitor/status/route.ts
import { NextResponse } from "next/server";

export async function GET() {
  // TODO: KV/Supabase에서 현재 활성 모니터 목록/상태 반환
  return NextResponse.json({ ok: true, monitors: [] });
}