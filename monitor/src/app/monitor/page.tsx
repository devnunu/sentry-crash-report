"use client";

import { useState } from "react";

type Platform = "android" | "ios";
type ApiResult = { ok?: boolean; error?: string; monitorId?: string };

export const dynamic = "force-dynamic";

export default function MonitorPage() {
  const [platform, setPlatform] = useState<Platform>("android");
  const [baseRelease, setBaseRelease] = useState("");
  const [days, setDays] = useState<number>(7);
  const [startResp, setStartResp] = useState<ApiResult | null>(null);
  const [stopId, setStopId] = useState("");
  const [stopResp, setStopResp] = useState<ApiResult | null>(null);
  const [statusJson, setStatusJson] = useState<string>("");

  const call = async (url: string, body?: object) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json() as Promise<ApiResult>;
  };

  const onStart = async () => {
    setStartResp(null);
    const data = await call("/api/monitor/start", { platform, baseRelease, days });
    setStartResp(data);
    if (data.monitorId) setStopId(data.monitorId);
  };

  const onStop = async () => {
    setStopResp(null);
    const data = await call("/api/monitor/stop", { monitorId: stopId });
    setStopResp(data);
  };

  const onStatus = async () => {
    const res = await fetch("/api/monitor/status", { cache: "no-store" });
    const j = await res.json();
    setStatusJson(JSON.stringify(j, null, 2));
  };

  return (
    <div className="container">
      <h1 className="h1">🚀 릴리즈 모니터링 컨트롤</h1>
      <p className="muted">특정 릴리즈(예: <span className="mono">4.69.0</span>)를 기준으로 7일간 자동 모니터링합니다.</p>

      {/* 시작 */}
      <div className="card">
        <h2 className="h2">▶️ 모니터링 시작</h2>
        <div className="row">
          <label>플랫폼</label>
          <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
            <option value="android">android</option>
            <option value="ios">ios</option>
          </select>

          <label>베이스 릴리즈</label>
          <input
            type="text"
            placeholder="예: 4.69.0"
            value={baseRelease}
            onChange={(e) => setBaseRelease(e.target.value)}
          />

          <label>기간(일)</label>
          <input
            type="number"
            min={1}
            max={14}
            value={days}
            onChange={(e) => setDays(Number(e.target.value || 7))}
            style={{ width: 90 }}
          />
        </div>

        <div className="row">
          <button className="btn ok" onClick={onStart}>모니터링 시작</button>
          {startResp?.ok && (
            <div className="kv" style={{ marginLeft: 8 }}>
              <div className="k">모니터 ID</div>
              <div className="v mono">{startResp.monitorId}</div>
            </div>
          )}
          {startResp?.error && <span className="muted">에러: {startResp.error}</span>}
        </div>
      </div>

      {/* 종료 */}
      <div className="card">
        <h2 className="h2">⏹️ 모니터링 종료</h2>
        <div className="row">
          <label>모니터 ID</label>
          <input
            type="text"
            placeholder="start 응답의 monitorId"
            value={stopId}
            onChange={(e) => setStopId(e.target.value)}
            className="mono"
            style={{ minWidth: 380 }}
          />
          <button className="btn danger" onClick={onStop}>모니터링 종료</button>
          {stopResp?.ok && <span className="muted">종료됨</span>}
          {stopResp?.error && <span className="muted">에러: {stopResp.error}</span>}
        </div>
      </div>

      {/* 상태 */}
      <div className="card">
        <h2 className="h2">📡 현재 상태</h2>
        <div className="row">
          <button className="btn ghost" onClick={onStatus}>새로고침</button>
        </div>
        <pre className="mono" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
{statusJson || "버튼을 눌러 상태를 조회하세요."}
        </pre>
      </div>

      <div className="muted" style={{ marginTop: 16 }}>
        * 보호 활성화 배포에서는 최초 진입 시 <span className="mono">x-vercel-protection-bypass</span> 토큰이 필요할 수 있어요.
      </div>
    </div>
  );
}