"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/* ===== 타입 ===== */
type Platform = "android" | "ios";

type StartResp = {
  ok?: boolean;
  error?: string;
  monitorId?: string;
};

type StopResp = {
  ok?: boolean;
  error?: string;
};

type MonitorRec = {
  id: string;
  platform: Platform;
  base_release: string;
  matched_release?: string | null;
  started_at: string;   // ISO
  expires_at: string;   // ISO
  last_run_at?: string | null;
  last_window_end?: string | null;
  cumul?: { events: number; issues: number; users: number };
  last_snapshot?: { events: number; issues: number; users: number };
};

type StatusResp = {
  monitors: MonitorRec[];
};

/* ===== 유틸 ===== */
function fmtKst(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return fmt.format(d);
}

function daysLeft(expiresIso: string): string {
  const now = Date.now();
  const exp = new Date(expiresIso).getTime();
  const ms = exp - now;
  if (ms <= 0) return "만료";
  const d = Math.floor(ms / (24 * 60 * 60 * 1000));
  const h = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  return d > 0 ? `${d}일 ${h}시간 남음` : `${h}시간 남음`;
}

/* ===== 페이지 ===== */
export const dynamic = "force-dynamic";

export default function MonitorPage() {
  // 시작 섹션
  const [platform, setPlatform] = useState<Platform>("android");
  const [baseRelease, setBaseRelease] = useState<string>("");
  const [days, setDays] = useState<number>(7);
  const [startResp, setStartResp] = useState<StartResp | null>(null);

  // 리스트/종료
  const [loadingList, setLoadingList] = useState<boolean>(false);
  const [listError, setListError] = useState<string>("");
  const [monitors, setMonitors] = useState<MonitorRec[]>([]);
  const [stoppingId, setStoppingId] = useState<string>("");

  const fetchStatus = useCallback(async () => {
    setLoadingList(true);
    setListError("");
    try {
      const res = await fetch("/api/monitor/status", { cache: "no-store" });
      const json: StatusResp = await res.json();
      setMonitors(json.monitors || []);
    } catch (e: unknown) {
      setListError("상태 조회 실패");
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const onStart = async () => {
    setStartResp(null);
    try {
      const res = await fetch("/api/monitor/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, baseRelease, days }),
      });
      const data: StartResp = await res.json();
      setStartResp(data);
      // 성공 시 목록 갱신
      if (data.ok) fetchStatus();
    } catch (e: unknown) {
      setStartResp({ ok: false, error: "시작 실패" });
    }
  };

  const onStopOne = async (id: string) => {
    setStoppingId(id);
    try {
      const res = await fetch("/api/monitor/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monitorId: id }),
      });
      const data: StopResp = await res.json();
      if (!data.ok) {
        alert(`종료 실패: ${data.error || "알 수 없음"}`);
      } else {
        // 바로 UI에서 제거 후, 안정화를 위해 재조회
        setMonitors((prev) => prev.filter((m) => m.id !== id));
        setTimeout(fetchStatus, 400);
      }
    } catch (e: unknown) {
      alert("종료 요청 실패");
    } finally {
      setStoppingId("");
    }
  };

  const sorted = useMemo(
    () =>
      [...monitors].sort(
        (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
      ),
    [monitors]
  );

  return (
    <div className="container">
      <h1 className="h1">🚀 릴리즈 모니터링 컨트롤</h1>
      <p className="muted">
        특정 릴리즈(예: <span className="mono">4.69.0</span>)를 기준으로 7일간 자동 모니터링합니다.
      </p>

      {/* 시작 카드 */}
      <div className="card">
        <h2 className="h2">▶️ 모니터링 시작</h2>
        <div className="row">
          <label>플랫폼</label>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as Platform)}
          >
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
          <button className="btn ok" onClick={onStart}>
            모니터링 시작
          </button>
        </div>

        {startResp && (
          <div className="row" style={{ marginTop: 6 }}>
            {startResp.ok ? (
              <span className="muted">
                시작됨 • 모니터 ID: <span className="mono">{startResp.monitorId}</span>
              </span>
            ) : (
              <span className="muted">에러: {startResp.error}</span>
            )}
          </div>
        )}
      </div>

      {/* 리스트/종료 카드 */}
      <div className="card">
        <h2 className="h2">⏹️ 활성 모니터 목록</h2>

        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="muted">
            총 {sorted.length}개 · 마지막 갱신:{" "}
            <span className="mono">{fmtKst(new Date().toISOString())}</span>
          </span>
          <button className="btn ghost" onClick={fetchStatus} disabled={loadingList}>
            {loadingList ? "갱신 중…" : "새로고침"}
          </button>
        </div>

        {listError && <div className="muted">⚠️ {listError}</div>}

        {sorted.length === 0 ? (
          <div className="muted">활성 모니터가 없습니다.</div>
        ) : (
          <div
            style={{
              width: "100%",
              overflowX: "auto",
              marginTop: 8,
              border: "1px solid var(--border)",
              borderRadius: 12,
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "separate",
                borderSpacing: 0,
                minWidth: 820,
              }}
            >
              <thead>
                <tr
                  style={{
                    background: "#0f1524",
                    color: "var(--muted)",
                  }}
                >
                  <th style={th}>모니터 ID</th>
                  <th style={th}>플랫폼</th>
                  <th style={th}>베이스 릴리즈</th>
                  <th style={th}>매칭 릴리즈</th>
                  <th style={th}>시작(KST)</th>
                  <th style={th}>만료(KST)</th>
                  <th style={th}>남은 기간</th>
                  <th style={{ ...th, textAlign: "right" }}>액션</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((m) => (
                  <tr
                    key={m.id}
                    style={{ borderBottom: "1px solid var(--border)" }}
                  >
                    <td style={tdMono}>{m.id}</td>
                    <td style={td}>{m.platform}</td>
                    <td style={tdMono}>{m.base_release}</td>
                    <td style={tdMono}>{m.matched_release || "-"}</td>
                    <td style={td}>{fmtKst(m.started_at)}</td>
                    <td style={td}>{fmtKst(m.expires_at)}</td>
                    <td style={td}>{daysLeft(m.expires_at)}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <button
                        className="btn danger"
                        onClick={() => onStopOne(m.id)}
                        disabled={stoppingId === m.id}
                        title="이 모니터를 종료합니다"
                      >
                        {stoppingId === m.id ? "종료 중…" : "종료"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 상태 Raw(JSON) — 디버깅/확장용 (선택) */}
      {/* <div className="card">
        <h2 className="h2">📡 Raw Status</h2>
        <pre className="mono" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
          {JSON.stringify({ monitors }, null, 2)}
        </pre>
      </div> */}

      <div className="muted" style={{ marginTop: 16 }}>
        * 보호 활성화 배포에서는 최초 진입 시{" "}
        <span className="mono">x-vercel-protection-bypass</span> 토큰이 필요할 수 있어요.
      </div>
    </div>
  );
}

/* ===== 테이블 스타일 ===== */
const th: React.CSSProperties = {
  padding: "12px 14px",
  textAlign: "left",
  fontWeight: 700,
  fontSize: 12,
  letterSpacing: 0.2,
  borderBottom: "1px solid var(--border)",
};

const td: React.CSSProperties = {
  padding: "12px 14px",
  fontSize: 13,
  verticalAlign: "middle",
};

const tdMono: React.CSSProperties = {
  ...td,
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
  wordBreak: "break-all",
};