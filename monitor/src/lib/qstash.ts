// src/lib/qstash.ts
/**
 * Upstash QStash 스케줄/취소 유틸
 * - 토큰이 없으면 no-op으로 동작(빌드/런타임 안전)
 * - 토큰이 있으면 실제 예약/취소 수행
 */

type ScheduleResult = {
  firstScheduleId?: string;
  secondScheduleId?: string;
};

const QSTASH_TOKEN = (process.env.UPSTASH_QSTASH_TOKEN || "").trim();
const APP_BASE_URL =
  (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_BASE_URL || "").trim() ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

/** 내부: QStash API 호출 도우미 */
async function qstashFetch<T>(path: string, init: RequestInit): Promise<T> {
  const url = `https://qstash.upstash.io${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${QSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`QStash ${path} failed ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

/**
 * 모니터용 tick 예약 2건(30분/60분)을 만들어준다(선택적).
 * - QSTASH_TOKEN이나 APP_BASE_URL이 없으면 예약을 생략하고 빈 결과를 돌려준다.
 */
export async function scheduleJobsForMonitor(_monitor: {
  id: string;
  // 필요한 정보를 확장해도 됨. 현재는 id만 사용.
}): Promise<ScheduleResult> {
  if (!QSTASH_TOKEN || !APP_BASE_URL) {
    // 예약 생략 (no-op)
    return {};
  }

  // QStash의 schedule 엔드포인트에 맞게 호출
  // 1) 30분 간격
  const tickUrl = `${APP_BASE_URL}/api/monitor/tick`;
  type QStashCreateResp = { scheduleId: string };

  const every30 = await qstashFetch<QStashCreateResp>("/v2/schedules", {
    method: "POST",
    body: JSON.stringify({
      destination: tickUrl,
      cron: "*/30 * * * *", // 30분 간격
      method: "POST",
      body: JSON.stringify({ reason: "monitor-30m" }),
    }),
  });

  // 2) 60분 간격
  const every60 = await qstashFetch<QStashCreateResp>("/v2/schedules", {
    method: "POST",
    body: JSON.stringify({
      destination: tickUrl,
      cron: "0 * * * *", // 매 정시
      method: "POST",
      body: JSON.stringify({ reason: "monitor-60m" }),
    }),
  });

  return {
    firstScheduleId: every30.scheduleId,
    secondScheduleId: every60.scheduleId,
  };
}

/** 라우트에서 쓰는 이름과 맞추기 위한 별칭(호환용) */
export const scheduleMonitorJobs = scheduleJobsForMonitor;

/** 스케줄 취소 (토큰 없으면 no-op) */
export async function cancelJob(scheduleId: string): Promise<void> {
  if (!QSTASH_TOKEN) return;
  await qstashFetch<unknown>(`/v2/schedules/${encodeURIComponent(scheduleId)}`, {
    method: "DELETE",
  });
}