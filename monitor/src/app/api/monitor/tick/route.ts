// app/api/monitor/tick/route.ts
import { NextResponse } from 'next/server';

export async function POST() {
  try {
    // 바로 파이썬 tick 실행
    const { spawn } = await import('node:child_process');
    await new Promise<void>((resolve, reject) => {
      const p = spawn('python', ['sentry_release_monitor.py', 'tick'], { env: process.env });
      p.stdout.on('data', (d) => process.stdout.write(d));
      p.stderr.on('data', (d) => process.stderr.write(d));
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('tick failed'))));
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}