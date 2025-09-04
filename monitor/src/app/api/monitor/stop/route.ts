// app/api/monitor/stop/route.ts
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { id } = await req.json();
    if (!id) throw new Error("id is required");
    // TODO: KV/Supabase에서 해당 모니터 비활성화 / 삭제
    return NextResponse.json({ ok: true, msg: `monitor ${id} stopped` });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
}