// app/api/monitor/tick/route.ts
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  // QStash 서명 검증(Optional) + 추가 토큰 검증
  const token = req.headers.get("x-monitor-token");
  if (token !== process.env.MONITOR_SHARED_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { monitorId, mode, platform, baseRelease, expiresAt } = await req.json();
  // const rec = await db.get(monitorId)
  const now = Date.now();

  if (!monitorId /*|| rec.status!=="running"*/ || now > /*rec.expiresAt*/ expiresAt) {
    // 만료/중지 시 스케줄 삭제(청소)
    // await cleanupSchedules(rec.scheduleIds)
    // await db.update(monitorId, { status: "stopped" })
    return NextResponse.json({ ok: true, skipped: "expired_or_stopped" });
  }

  // 여기서 Python/TS 로직으로 실제 집계 + Slack 전송
  // await runReleaseTick(platform, baseRelease, mode)

  return NextResponse.json({ ok: true });
}