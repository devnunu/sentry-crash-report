import { NextResponse } from "next/server";
import { listMonitors, type MonitorRec } from "@/lib/releaseMonitor";

type MonitorItem = {
  id: string;
  platform: "android" | "ios";
  base_release: string;
  matched_release?: string | null;
  started_at: string;
  expires_at: string;
  last_run_at?: string | null;
  last_window_end?: string | null;
  cumul: { events: number; issues: number; users: number };
  last_snapshot: { events: number; issues: number; users: number };
};

type StatusResp =
  | { monitors: MonitorItem[] }
  | { error: string };

export async function GET() {
  try {
    const monitors = await listMonitors();
    const converted: MonitorItem[] = monitors.map(m => ({
      id: m.id,
      platform: m.platform,
      base_release: m.baseRelease,
      matched_release: m.matchedRelease || null,
      started_at: m.startedAt,
      expires_at: m.expiresAt,
      last_run_at: m.lastRunAt || null,
      last_window_end: m.lastWindowEnd || null,
      cumul: m.cumul,
      last_snapshot: m.lastSnapshot,
    }));
    return NextResponse.json<StatusResp>({ monitors: converted });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json<StatusResp>({ error: msg }, { status: 500 });
  }
}