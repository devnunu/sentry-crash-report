'use client';

import { useCallback, useMemo, useState } from 'react';

type StartResp = {
  ok?: boolean;
  monitorId?: string;
  scheduleIds?: (string | null)[];
  error?: string;
};

type StopResp = {
  ok?: boolean;
  cancelled?: string[];
  error?: string;
};

export default function MonitorPage() {
  const [platform, setPlatform] = useState<'android' | 'ios'>('android');
  const [baseRelease, setBaseRelease] = useState<string>('');
  const [days, setDays] = useState<number>(7);

  const [starting, setStarting] = useState(false);
  const [startResult, setStartResult] = useState<StartResp | null>(null);

  const [monitorId, setMonitorId] = useState<string>('');
  const [stopping, setStopping] = useState(false);
  const [stopResult, setStopResult] = useState<StopResp | null>(null);

  // Vercel 보호 우회 토큰이 있으면 붙여줌
  const bypass = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const url = new URL(window.location.href);
    const token = url.searchParams.get('x-vercel-protection-bypass');
    return token ? `?x-vercel-protection-bypass=${encodeURIComponent(token)}` : '';
  }, []);

  const apiStart = useCallback(async () => {
    setStarting(true);
    setStartResult(null);
    try {
      const res = await fetch(`/api/monitor/start${bypass}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, baseRelease, days }),
      });
      const json = (await res.json()) as StartResp;
      setStartResult(json);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setStartResult({ ok: false, error: err.message });
      } else {
        setStartResult({ ok: false, error: 'unknown error' });
      }
    } finally {
      setStarting(false);
    }
  }, [platform, baseRelease, days, bypass]);

  const apiStop = useCallback(async () => {
    setStopping(true);
    setStopResult(null);
    try {
      const res = await fetch(`/api/monitor/stop${bypass}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monitorId }),
      });
      const json = (await res.json()) as StopResp;
      setStopResult(json);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setStopResult({ ok: false, error: err.message });
      } else {
        setStopResult({ ok: false, error: 'unknown error' });
      }
    } finally {
      setStopping(false);
    }
  }, [monitorId, bypass]);

  const disableStart = !baseRelease || starting;
  const disableStop = !monitorId || stopping;

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">🚀 릴리즈 모니터링 컨트롤</h1>
        <p className="text-sm text-gray-600">
          특정 릴리즈(예: <code>4.69.0</code>)를 기준으로 7일간 자동 모니터링합니다.
        </p>
      </header>

      {/* Start */}
      <section className="rounded-2xl border border-gray-200 p-5 shadow-sm space-y-4">
        <h2 className="text-lg font-semibold">▶️ 모니터링 시작</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">플랫폼</span>
            <select
              className="rounded-lg border px-3 py-2"
              value={platform}
              onChange={(e) => setPlatform(e.target.value as 'android' | 'ios')}
            >
              <option value="android">android</option>
              <option value="ios">ios</option>
            </select>
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">베이스 릴리즈</span>
            <input
              className="rounded-lg border px-3 py-2"
              placeholder="예: 4.69.0"
              value={baseRelease}
              onChange={(e) => setBaseRelease(e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">기간(일)</span>
            <input
              type="number"
              min={1}
              max={14}
              className="rounded-lg border px-3 py-2"
              value={days}
              onChange={(e) => setDays(Number(e.target.value || 7))}
            />
          </label>
        </div>

        <button
          onClick={apiStart}
          disabled={disableStart}
          className={`rounded-xl px-4 py-2 text-white ${disableStart ? 'bg-gray-400' : 'bg-black hover:bg-gray-800'} transition`}
        >
          {starting ? '시작 중…' : '모니터링 시작'}
        </button>

        {startResult && (
          <pre className="whitespace-pre-wrap break-words text-sm mt-3">
            {JSON.stringify(startResult, null, 2)}
          </pre>
        )}
      </section>

      {/* Stop */}
      <section className="rounded-2xl border border-gray-200 p-5 shadow-sm space-y-4">
        <h2 className="text-lg font-semibold">⏹️ 모니터링 종료</h2>
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">모니터 ID</span>
          <input
            className="rounded-lg border px-3 py-2"
            placeholder="start 응답의 monitorId"
            value={monitorId}
            onChange={(e) => setMonitorId(e.target.value)}
          />
        </label>

        <button
          onClick={apiStop}
          disabled={disableStop}
          className={`rounded-xl px-4 py-2 text-white ${disableStop ? 'bg-gray-400' : 'bg-red-600 hover:bg-red-700'} transition`}
        >
          {stopping ? '종료 중…' : '모니터링 종료'}
        </button>

        {stopResult && (
          <pre className="whitespace-pre-wrap break-words text-sm mt-3">
            {JSON.stringify(stopResult, null, 2)}
          </pre>
        )}
      </section>
    </main>
  );
}