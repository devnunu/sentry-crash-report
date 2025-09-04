// app/api/monitor/start/route.ts
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const platform = body.platform;         // "android" | "ios"
    const baseRelease = body.baseRelease;   // e.g. "4.69.0"
    if (!platform || !baseRelease) {
      return NextResponse.json({ ok: false, error: 'platform/baseRelease required' }, { status: 400 });
    }

    // 모니터 생성 (로컬 파일 state에 기록하는 파이썬 스크립트를 호출)
    // 필요 시 child_process.spawn 으로 실행하거나, 서버에서 직접 로직 수행
    // 여기서는 간단히 파이썬 스크립트를 child_process로 호출했다고 가정
    const { spawn } = await import('node:child_process');
    await new Promise<void>((resolve, reject) => {
      const p = spawn('python', ['sentry_release_monitor.py', 'start', '--platform', platform, '--base-release', baseRelease], {
        env: process.env,
      });
      p.stdout.on('data', (d) => process.stdout.write(d));
      p.stderr.on('data', (d) => process.stderr.write(d));
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('start failed'))));
    });

    // === QStash에 주기 호출 등록 (첫 24시간/그 후) ===
    // 보호 우회가 켜져있다면 URL에 ?x-vercel-protection-bypass=... 를 붙인 URL을 사용하세요.
    const qstashToken = process.env.UPSTASH_QSTASH_TOKEN;
    const tickUrl = process.env.MONITOR_TICK_URL!; // 예: https://<domain>/api/monitor/tick[?x-vercel-protection-bypass=...]
    if (!qstashToken || !tickUrl) {
      return NextResponse.json({ ok: true, monitorId: null, scheduleIds: [null, null], note: 'QStash not configured' });
    }

    // 1) 첫 24시간 동안 30분 간격 (크론 30분 표현: */30 * * * *)
    // 2) 이후 7일 끝까지 60분 간격 (크론 60분: 0 * * * *)
    // 단순화를 위해 둘 다 “즉시 활성화”하고, tick 내부에서 cadence를 자체 판단합니다.
    const createSchedule = async (cron: string) => {
      const res = await fetch('https://qstash.upstash.io/v2/schedules', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${qstashToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          destination: tickUrl,
          cron,
          method: 'POST',
          // 이 예시에서는 추가 헤더 없음(토큰 검증 제거)
          // headers: {},
          // body 없이 호출 → tick에서 자체적으로 active monitor 찾아 실행
        }),
      });
      if (!res.ok) return null;
      const j = await res.json().catch(() => ({}));
      return j.scheduleId || j.schedule_id || null;
    };

    const id30 = await createSchedule('*/30 * * * *'); // 30분
    const id60 = await createSchedule('0 * * * *');    // 60분

    return NextResponse.json({ ok: true, monitorId: '(local-state)', scheduleIds: [id30, id60] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}