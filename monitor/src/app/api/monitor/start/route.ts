// app/api/monitor/start/route.ts
import { NextResponse } from "next/server";

function required(name: string, v?: string) {
  if (!v) throw new Error(`${name} is required`);
  return v;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const platform = required("platform", body.platform); // "android" | "ios"
    const baseRelease = required("baseRelease", body.baseRelease); // "4.69.0" 형식
    const days = Number(body.days ?? 7);

    // TODO: 여기서 KV/Supabase 등에 상태 저장 (id, startedAt, expiresAt 등)
    // 예: await kv.hset(`monitor:${id}`, {...})

    return NextResponse.json({ ok: true, msg: "monitor started", platform, baseRelease, days });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
  }
}