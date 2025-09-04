// app/api/monitor/tick/route.ts
import { NextResponse } from "next/server";

export async function POST() {
  // TODO:
  // 1) 활성 모니터 목록 로드 (KV/Supabase)
  // 2) 각 모니터별로 "이번 tick을 실행해야 하는지" 판단 (시작 후 24시간=30분 주기, 이후=60분 주기)
  // 3) Sentry REST API 호출 → 스냅샷 계산
  // 4) Slack Webhook 전송 (SLACK_MONITORING_WEBHOOK_URL)
  // 5) 상태/누적치 업데이트 저장
  return NextResponse.json({ ok: true, msg: "tick processed (stub)" });
}