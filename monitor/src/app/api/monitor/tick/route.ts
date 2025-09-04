import { NextResponse } from "next/server";
import { runTick } from "@/lib/releaseMonitor";

type TickResp =
  | { ok: true; message?: string }
  | { error: string };

export async function POST() {
  try {
    // 모든 활성 모니터에 대해 1회 tick 실행
    await runTick();
    return NextResponse.json<TickResp>({ ok: true, message: "tick executed" });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json<TickResp>({ error: msg }, { status: 500 });
  }
}