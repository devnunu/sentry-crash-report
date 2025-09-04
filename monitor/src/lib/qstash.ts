import { Client } from "@upstash/qstash";

const qstash = new Client({
  token: process.env.UPSTASH_QSTASH_TOKEN!,
});

type ScheduleResp = { scheduleId: string | null };

// Upstash publish 응답의 messageId만 안전 추출
type PublishJSONResponse = unknown;
function extractMessageId(resp: PublishJSONResponse): string | null {
  if (resp && typeof resp === "object" && "messageId" in (resp as Record<string, unknown>)) {
    const id = (resp as { messageId?: string }).messageId;
    return typeof id === "string" ? id : null;
  }
  return null;
}

export async function scheduleJobsForMonitor(params: {
  tickUrl: string;
  body: Record<string, unknown>;
  tokenHeaderValue: string; // "Bearer <MONITOR_SHARED_TOKEN>"
}): Promise<{ firstSchedule: ScheduleResp; nextSchedule: ScheduleResp }> {
  const { tickUrl, body, tokenHeaderValue } = params;
  const headers = { Authorization: tokenHeaderValue };

  // 1분 뒤 한 번 예약
  const firstResp: PublishJSONResponse = await qstash.publishJSON({
    url: tickUrl,
    headers,
    body,
    delay: 60,
  });

  // 31분 뒤 백업 예약
  const secondResp: PublishJSONResponse = await qstash.publishJSON({
    url: tickUrl,
    headers,
    body,
    delay: 31 * 60,
  });

  return {
    firstSchedule: { scheduleId: extractMessageId(firstResp) },
    nextSchedule: { scheduleId: extractMessageId(secondResp) },
  };
}

/**
 * 단발 예약 구조에서는 취소가 실질적 의미가 없어서 no-op.
 * (필요 시 QStash REST로 확장 가능)
 */
export async function cancelJob(scheduleId?: string): Promise<void> {
  // scheduleId가 넘어오면 로깅/추후 확장 포인트로 사용할 수 있음
  void scheduleId;
  return;
}