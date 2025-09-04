import { NextResponse } from "next/server";
import { scheduleJobsForMonitor } from "@/lib/qstash";          // QStash 예약 생성
import { createMonitor } from "@/lib/releaseMonitor";           // 상태 저장(Upstash Redis 또는 메모리)

type StartBody = {
  platform: "android" | "ios";
  baseRelease: string;   // 예: "4.69.0"
  days?: number;         // 기본 7
};

type StartResp = {
  ok: true;
  monitorId: string;
  scheduleIds: { halfHour: string | null; hourly: string | null };
} | { error: string };

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as StartBody;

    if (!body?.platform || !["android", "ios"].includes(body.platform)) {
      return NextResponse.json<StartResp>({ error: "platform must be 'android' or 'ios'" }, { status: 400 });
    }
    if (!body?.baseRelease) {
      return NextResponse.json<StartResp>({ error: "baseRelease is required (e.g., 4.69.0)" }, { status: 400 });
    }

    const days = typeof body.days === "number" && body.days > 0 ? body.days : 7;

    // 1) 모니터 생성(상태 저장)
    const monitor = await createMonitor({
      platform: body.platform,
      baseRelease: body.baseRelease,
      days,
    });

    // 2) 예약 잡 생성 (첫 24시간/그 이후)
    const schedule = await scheduleJobsForMonitor({ id: monitor.id });

    return NextResponse.json<StartResp>({
      ok: true,
      monitorId: monitor.id,
      scheduleIds: { halfHour: schedule.firstScheduleId || null, hourly: schedule.secondScheduleId || null },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json<StartResp>({ error: msg }, { status: 500 });
  }
}