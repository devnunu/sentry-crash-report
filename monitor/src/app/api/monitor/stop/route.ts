// src/app/api/monitor/stop/route.ts
import { NextResponse } from "next/server";
import { cancelJob } from "@/lib/qstash";

type StopBody = {
  scheduleId?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as StopBody;
    if (body.scheduleId) {
      await cancelJob(body.scheduleId);
      return NextResponse.json({ ok: true, canceled: body.scheduleId });
    }
    // no-op
    return NextResponse.json({ ok: true, note: "nothing to cancel (single-shot scheduling)" });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message ?? "stop failed" }, { status: 500 });
  }
}