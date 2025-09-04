import { spawn } from "node:child_process";

export async function runTick(payload: Record<string, unknown>): Promise<{ ok: boolean; log?: string }> {
  const isVercel = !!process.env.VERCEL;
  if (isVercel) {
    // 서버리스 환경: 여기서 TS로 Sentry API를 직접 호출하도록 확장 예정.
    // 일단은 수신 payload를 로그에 반영하여 unused 경고 제거.
    return {
      ok: true,
      log: `Tick accepted (serverless no-op). Payload=${JSON.stringify(payload)}`,
    };
  }

  // 로컬 개발: 파이썬 스크립트 실행
  return new Promise((resolve) => {
    const env = { ...process.env };
    const args = ["sentry_release_monitor.py", "tick"];
    const child = spawn("python3", args, { env });

    let out = "";
    let err = "";

    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));

    child.on("close", (code) => {
      const log = `[tick] exit=${code}\nSTDOUT:\n${out}\nSTDERR:\n${err}`;
      resolve({ ok: code === 0, log });
    });
  });
}