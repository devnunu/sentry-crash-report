import { NextResponse } from "next/server";
import { stopMonitorById } from "@/lib/releaseMonitor"; // 상태 삭제 + 예약 취소까지 내부에서 수행

type StopBody = { monitorId: string };
type StopResp =
  | { ok: true; monitorId: string }
  | { error: string };

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as StopBody;
    if (!body?.monitorId) {
      return NextResponse.json<StopResp>({ error: "monitorId required" }, { status: 400 });
    }

    await stopMonitorById(body.monitorId);
    return NextResponse.json<StopResp>({ ok: true, monitorId: body.monitorId });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json<StopResp>({ error: msg }, { status: 500 });
  }
}