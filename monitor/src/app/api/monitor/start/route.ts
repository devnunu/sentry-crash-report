// app/api/monitor/start/route.ts
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { platform, baseRelease, days = 7 } = await req.json();
  // 1) monitor 레코드 생성 (id, expiresAt 등) → DB 저장
  const monitorId = crypto.randomUUID();
  const expiresAt = Date.now() + days*24*60*60*1000;

  // 2) QStash 스케줄 2개 생성
  const target = `${process.env.APP_URL}/api/monitor/tick`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.UPSTASH_QSTASH_TOKEN!}`,
  };

  const bodyBase = { monitorId, platform, baseRelease, expiresAt };

  // 30분(빠른) 주기
  const fast = await fetch("https://qstash.upstash.io/v2/schedules", {
    method: "POST",
    headers,
    body: JSON.stringify({
      destination: target,
      cron: "*/30 * * * *",
      body: JSON.stringify({ ...bodyBase, mode: "fast" }),
      // 필요시 "retries" 등 추가
    }),
  }).then(r => r.json());

  // 60분(느린) 주기
  const slow = await fetch("https://qstash.upstash.io/v2/schedules", {
    method: "POST",
    headers,
    body: JSON.stringify({
      destination: target,
      cron: "0 * * * *",
      body: JSON.stringify({ ...bodyBase, mode: "slow" }),
    }),
  }).then(r => r.json());

  // 3) 스케줄 id 저장
  // await db.save(monitorId, { scheduleIds: [fast.scheduleId, slow.scheduleId], expiresAt, status:"running" })

  return NextResponse.json({ ok: true, monitorId, scheduleIds: [fast.scheduleId, slow.scheduleId] });
}