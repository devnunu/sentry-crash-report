// src/app/api/monitor/start/route.ts
import { NextResponse } from "next/server";
import { scheduleJobsForMonitor } from "@/lib/qstash";

type StartBody = {
  platform: "android" | "ios";
  baseRelease: string; // "4.69.0"
  days?: number;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as StartBody;

    if (!body?.platform || !body?.baseRelease) {
      return NextResponse.json({ error: "platform/baseRelease required" }, { status: 400 });
    }

    const appUrl = process.env.APP_BASE_URL!;
    const token = process.env.MONITOR_SHARED_TOKEN!;
    if (!appUrl || !token) {
      return NextResponse.json({ error: "APP_BASE_URL / MONITOR_SHARED_TOKEN not set" }, { status: 500 });
    }

    const tickUrl = `${appUrl.replace(/\/$/, "")}/api/monitor/tick`;
    const authHeader = `Bearer ${token}`;

    const sched = await scheduleJobsForMonitor({
      tickUrl,
      tokenHeaderValue: authHeader,
      body: {
        platform: body.platform,
        baseRelease: body.baseRelease,
        days: body.days ?? 7,
      },
    });

    return NextResponse.json({
      ok: true,
      scheduleIds: [sched.firstSchedule.scheduleId, sched.nextSchedule.scheduleId],
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message ?? "start failed" }, { status: 500 });
  }
}