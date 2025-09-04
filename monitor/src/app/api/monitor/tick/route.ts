// src/app/api/monitor/tick/route.ts
import { NextResponse } from "next/server";
import { runTick } from "@/lib/releaseMonitor";

function okAuth(req: Request): boolean {
  const shared = process.env.MONITOR_SHARED_TOKEN || "";
  if (!shared) return false;

  // 1) Authorization 헤더
  const auth = req.headers.get("authorization") || "";
  if (auth === `Bearer ${shared}`) return true;

  // 2) ?token= 쿼리 (수동 테스트 용)
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (token && token === shared) return true;

  return false;
}

export async function POST(req: Request) {
  try {
    if (!okAuth(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await runTick(body);
    return NextResponse.json({ ok: result.ok, log: result.log ?? "" });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message ?? "tick failed" }, { status: 500 });
  }
}