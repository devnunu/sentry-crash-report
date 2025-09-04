// src/lib/releaseMonitor.ts
/**
 * 릴리즈 모니터 상태 저장/조회/종료 + tick 더미 실행
 * - 저장소: Upstash Redis(REST) 우선, 없으면 인메모리 폴백
 * - 라우트에서 기대하는 export 이름을 모두 제공:
 *   - createMonitor, listMonitors, stopMonitorById, runTick
 */

import crypto from "node:crypto";

// ===== Types =====
export type Platform = "android" | "ios";

export interface MonitorRec {
  id: string;
  platform: Platform;
  baseRelease: string; // e.g. "4.69.0"
  days: number;
  matchedRelease?: string;
  startedAt: string; // ISO
  expiresAt: string; // ISO
  lastRunAt?: string; // ISO
  lastWindowEnd?: string; // ISO
  cumul: { events: number; issues: number; users: number };
  lastSnapshot: { events: number; issues: number; users: number };
  // 예약 ID(있다면)
  scheduleIds?: { firstScheduleId?: string; secondScheduleId?: string };
}

// ===== Env (Upstash Redis REST) =====
const REDIS_URL = (process.env.UPSTASH_REDIS_REST_URL || "").trim();
const REDIS_TOKEN = (process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();

const USE_REDIS = Boolean(REDIS_URL && REDIS_TOKEN);

// ===== In-memory fallback =====
const memStore = {
  list: new Set<string>(),
  map: new Map<string, MonitorRec>(),
};

// ===== Redis helpers =====
async function redisFetch<T>(cmd: unknown[]): Promise<T> {
  // Upstash REST: POST JSON {"command": ["SET", "key", "value"]}
  const res = await fetch(REDIS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ command: cmd }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Redis error ${res.status}: ${txt}`);
  }
  return (await res.json()) as T;
}

const KEY_LIST = "monitor:list"; // Redis Set 키

async function redisAddToList(id: string): Promise<void> {
  await redisFetch<unknown>(["SADD", KEY_LIST, id]);
}

async function redisRemoveFromList(id: string): Promise<void> {
  await redisFetch<unknown>(["SREM", KEY_LIST, id]);
}

async function redisGetList(): Promise<string[]> {
  const r = await redisFetch<{ result: string[] }>(["SMEMBERS", KEY_LIST]);
  return Array.isArray(r.result) ? r.result : [];
}

function keyMonitor(id: string): string {
  return `monitor:item:${id}`;
}

async function redisSetMonitor(m: MonitorRec): Promise<void> {
  await redisFetch<unknown>(["SET", keyMonitor(m.id), JSON.stringify(m)]);
}

async function redisGetMonitor(id: string): Promise<MonitorRec | null> {
  const r = await redisFetch<{ result: string | null }>(["GET", keyMonitor(id)]);
  if (typeof r.result !== "string") return null;
  try {
    return JSON.parse(r.result) as MonitorRec;
  } catch {
    return null;
  }
}

async function redisDelMonitor(id: string): Promise<void> {
  await redisFetch<unknown>(["DEL", keyMonitor(id)]);
}

// ===== Public API =====

export type MonitorCreateInput = {
  platform: Platform;
  baseRelease: string;
  days?: number;
};

/** 모니터 생성 */
export async function createMonitor(input: MonitorCreateInput): Promise<MonitorRec> {
  const id = crypto.randomUUID();
  const now = new Date();
  const days = input.days ?? 7;

  const rec: MonitorRec = {
    id,
    platform: input.platform,
    baseRelease: input.baseRelease,
    days,
    startedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString(),
    cumul: { events: 0, issues: 0, users: 0 },
    lastSnapshot: { events: 0, issues: 0, users: 0 },
  };

  if (USE_REDIS) {
    await redisSetMonitor(rec);
    await redisAddToList(id);
  } else {
    memStore.map.set(id, rec);
    memStore.list.add(id);
  }

  return rec;
}

/** 모니터 목록 */
export async function listMonitors(): Promise<MonitorRec[]> {
  if (USE_REDIS) {
    const ids = await redisGetList();
    const out: MonitorRec[] = [];
    for (const id of ids) {
      const m = await redisGetMonitor(id);
      if (m) out.push(m);
    }
    // 최신 생성 순으로 표시 (startedAt 내림차순)
    out.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    return out;
  }
  // in-memory
  const out: MonitorRec[] = [];
  for (const id of memStore.list) {
    const m = memStore.map.get(id);
    if (m) out.push(m);
  }
  out.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  return out;
}

/** 모니터 종료(삭제) */
export async function stopMonitorById(monitorId: string): Promise<{ ok: true }> {
  if (USE_REDIS) {
    await redisDelMonitor(monitorId);
    await redisRemoveFromList(monitorId);
    return { ok: true };
  }
  memStore.map.delete(monitorId);
  memStore.list.delete(monitorId);
  return { ok: true };
}

/**
 * tick 실행(더미)
 * - 실제 릴리즈/이슈 수집 & Slack 전송 로직은 추후 연결
 * - 지금은 상태를 약간 업데이트만 해서 "돌았다"는 흔적만 남김
 */
export async function runTick(): Promise<{ ok: true; touched: number }> {
  const list = await listMonitors();
  let touched = 0;
  const nowIso = new Date().toISOString();

  for (const m of list) {
    // 만료 지나면 스킵
    if (new Date(m.expiresAt).getTime() < Date.now()) continue;

    // 더미로 마지막 실행 시간/창만 갱신
    m.lastRunAt = nowIso;
    m.lastWindowEnd = nowIso;

    if (USE_REDIS) {
      await redisSetMonitor(m);
    } else {
      memStore.map.set(m.id, m);
    }
    touched += 1;
  }
  return { ok: true, touched };
}

/* === 호환용 선언(라우트에서 기대하는 이름이 다를 경우를 대비한 별칭) === */
export type { MonitorRec as MonitorRecord };