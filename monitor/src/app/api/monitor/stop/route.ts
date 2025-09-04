// app/api/monitor/stop/route.ts
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { monitorId } = await req.json();
  // const { scheduleIds } = await db.get(monitorId)

  const headers = {
    Authorization: `Bearer ${process.env.UPSTASH_QSTASH_TOKEN!}`,
  };

  for (const id of /*scheduleIds*/ []) {
    await fetch(`https://qstash.upstash.io/v2/schedules/${id}`, { method: "DELETE", headers });
  }

  // await db.update(monitorId, { status: "stopped" })
  return NextResponse.json({ ok: true });
}