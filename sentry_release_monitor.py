#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sentry 릴리즈 모니터링 리포트 (특정 버전 중심, 7일 한정 러닝)
- 입력: base release (예: 4.69.0) → 실행 시점에 4.69.0+908 같은 full 버전으로 자동 매칭
- 첫 24시간은 30분마다, 이후 기간은 60분마다 집계 창 권장 (tick 실행 주기로 조절)
- 집계 항목(스냅샷 기준): 이벤트/유니크 이슈/영향 사용자 + 윈도우 Top5 이슈
- 델타(직전 tick 대비)와 누적(모니터 시작 이후)의 개략 수치 동시 제공
- Slack Webhook 전송

실행 예시:
  # 모니터 생성 (안드로이드, base release만 입력)
  python sentry_release_monitor.py start --platform android --base-release 4.69.0

  # 주기 실행 (CI/크론에서 30분 또는 60분마다)
  python sentry_release_monitor.py tick
"""

import json
import os
import re
import sys
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import requests
from dotenv import load_dotenv

API_BASE = "https://sentry.io/api/0"

def getenv_clean(name: str, default: str = "") -> str:
    """환경변수에서 앞뒤 공백/줄바꿈 제거하여 반환"""
    return (os.getenv(name) or default).strip()

# ---- 타임존 ----
try:
    from zoneinfo import ZoneInfo
except Exception:
    from backports.zoneinfo import ZoneInfo  # type: ignore
KST = ZoneInfo("Asia/Seoul")
UTC = timezone.utc

# ---- 환경/상태 ----
STATE_PATH = getenv_clean("MONITOR_STATE_PATH", ".release_monitor_state.json")

# ---- 표시 상수 ----
TITLE_MAX = 90
TOP_LIMIT = 5

# ---- 공용 로깅 유틸 ----
def pstep(prefix: str, idx: int, total: int, msg: str) -> None:
    print(f"[{prefix}] [{idx}/{total}] {msg}")

def psub(prefix: str, msg: str) -> None:
    print(f"[{prefix}]   - {msg}")

# ---- 공통 유틸 ----
def now_utc() -> datetime:
    return datetime.now(UTC)

def to_iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")

def from_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(UTC)

def auth_headers(tok: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {tok}"}

def ensure_ok(r: requests.Response) -> requests.Response:
    try:
        r.raise_for_status()
    except requests.HTTPError as e:
        msg = f"HTTP {r.status_code} for {r.request.method} {r.url}\nResponse: {r.text[:800]}"
        raise SystemExit(msg) from e
    return r

def load_state() -> Dict[str, Any]:
    if not os.path.exists(STATE_PATH):
        return {"monitors": []}
    with open(STATE_PATH, "r", encoding="utf-8") as f:
        try:
            return json.load(f) or {"monitors": []}
        except Exception:
            return {"monitors": []}

def save_state(st: Dict[str, Any]) -> None:
    with open(STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(st, f, ensure_ascii=False, indent=2)

def bold(s: str) -> str:
    return f"*{s}*"

def truncate(s: Optional[str], n: int) -> str:
    if not s:
        return "(제목 없음)"
    return s if len(s) <= n else s[: n - 1] + "…"

def diff_emoji(delta: int) -> str:
    if delta > 0: return ":small_red_triangle:"
    if delta < 0: return ":small_red_triangle_down:"
    return "—"

# ---- 프로젝트 확인 ----
def resolve_project_id(token: str, org: str, slug: Optional[str], id_env: Optional[str]) -> int:
    if id_env:
        return int(id_env)
    if not slug:
        raise SystemExit("SENTRY_PROJECT_SLUG 또는 SENTRY_PROJECT_ID 중 하나는 필요합니다.")
    url = f"{API_BASE}/organizations/{org}/projects/"
    r = ensure_ok(requests.get(url, headers=auth_headers(token), timeout=30))
    for p in r.json():
        if p.get("slug") == slug:
            return int(p.get("id"))
    raise SystemExit(f"'{slug}' 프로젝트를 찾을 수 없습니다.")

# ---- 릴리즈 목록/매칭 ----
SEMVER_CORE = re.compile(r"^\d+\.\d+\.\d+$")

def list_releases_paginated(token: str, org: str, project_id: int, per_page: int=100, max_pages: int=10) -> List[Dict[str, Any]]:
    url = f"{API_BASE}/organizations/{org}/releases/"
    out: List[Dict[str, Any]] = []
    headers = auth_headers(token)
    cursor = None
    pages = 0
    while True:
        pages += 1
        params = {"project": project_id, "per_page": min(max(per_page,1),100)}
        if cursor: params["cursor"] = cursor
        r = ensure_ok(requests.get(url, headers=headers, params=params, timeout=60))
        arr = r.json() or []
        out.extend(arr)
        link = r.headers.get("link","")
        nxt = None
        if 'rel="next"' in link and 'results="true"' in link:
            m = re.search(r'cursor="?([^">]+)"?', link)
            nxt = m.group(1) if m else None
            if nxt and ":-1:" in nxt:
                nxt = None
        cursor = nxt
        if not cursor or not arr or pages >= max_pages:
            break
    return out

def match_full_release(token: str, org: str, project_id: int, base_release: str) -> Optional[str]:
    """
    base_release: '4.69.0' 형식만 허용 → 가장 최신 build(+N) 선택
    """
    if not SEMVER_CORE.match(base_release):
        raise SystemExit(f"base-release 형식이 올바르지 않습니다: {base_release}")
    rels = list_releases_paginated(token, org, project_id, per_page=100, max_pages=10)
    cands = []
    for r in rels:
        name = str(r.get("version") or r.get("shortVersion") or "").strip()
        if name.startswith(base_release):
            cands.append(name)
    if not cands:
        return None
    def build_num(v: str) -> int:
        if "+" in v:
            try:
                return int(v.split("+")[1])
            except Exception:
                return 0
        return 0
    cands.sort(key=build_num, reverse=True)
    return cands[0]

def get_release_created_at(token: str, org: str, project_id: int, version: str) -> Optional[datetime]:
    """릴리즈 생성/배포 시간(있으면 dateReleased, 없으면 dateCreated)"""
    url = f"{API_BASE}/organizations/{org}/releases/{version}/"
    r = ensure_ok(requests.get(url, headers=auth_headers(token), params={"project": project_id}, timeout=30))
    obj = r.json() or {}
    ts = obj.get("dateReleased") or obj.get("dateCreated")
    return from_iso(ts) if ts else None

# ---- Discover 집계(윈도우) ----
LEVEL_QUERY = "level:[error,fatal]"

def window_aggregates(token: str, org: str, project_id: int, environment: Optional[str],
                      release_full: str, start_iso: str, end_iso: str) -> Dict[str, Any]:
    url = f"{API_BASE}/organizations/{org}/events/"
    q = [LEVEL_QUERY, f"release:{release_full}"]
    if environment:
        q.append(f"environment:{environment}")
    params = {
        "field": ["count()", "count_unique(issue)", "count_unique(user)"],
        "project": project_id,
        "start": start_iso,
        "end": end_iso,
        "query": " ".join(q),
        "referrer": "api.release.monitor.agg",
    }
    r = ensure_ok(requests.get(url, headers=auth_headers(token), params=params, timeout=60))
    rows = (r.json().get("data") or [])
    if not rows:
        return {"events": 0, "issues": 0, "users": 0}
    row0 = rows[0]
    return {
        "events": int(row0.get("count()") or 0),
        "issues": int(row0.get("count_unique(issue)") or 0),
        "users": int(row0.get("count_unique(user)") or 0),
    }

def window_top_issues(token: str, org: str, project_id: int, environment: Optional[str],
                      release_full: str, start_iso: str, end_iso: str, limit: int=TOP_LIMIT) -> List[Dict[str, Any]]:
    url = f"{API_BASE}/organizations/{org}/events/"
    q = [LEVEL_QUERY, f"release:{release_full}"]
    if environment:
        q.append(f"environment:{environment}")
    params = {
        "field": ["issue.id", "issue", "title", "count()", "count_unique(user)"],
        "project": project_id,
        "start": start_iso,
        "end": end_iso,
        "query": " ".join(q),
        "orderby": "-count()",
        "per_page": min(max(limit,1),100),
        "referrer": "api.release.monitor.top",
    }
    r = ensure_ok(requests.get(url, headers=auth_headers(token), params=params, timeout=60))
    rows = r.json().get("data") or []
    out = []
    for row in rows[:limit]:
        iid = str(row.get("issue.id") or "")
        out.append({
            "issue_id": iid,
            "short_id": row.get("issue"),
            "title": row.get("title"),
            "events": int(row.get("count()") or 0),
            "users": int(row.get("count_unique(user)") or 0),
            "link": f"https://sentry.io/organizations/{org}/issues/{iid}/" if iid else None,
        })
    return out

# ---- Slack ----
def build_action_urls(org: str, project_id: int, environment: Optional[str],
                      release_full: str, start_iso: str, end_iso: str) -> Dict[str,str]:
    # 대시보드(커스텀 있으면 우선)
    dash = getenv_clean("SENTRY_DASHBOARD_URL") or f"https://sentry.io/organizations/{org}/projects/"
    # 이슈 필터 (release + level + env + 기간)
    from urllib.parse import quote_plus
    q = [LEVEL_QUERY, f"release:{release_full}"]
    if environment:
        q.append(f"environment:{environment}")
    qstr = quote_plus(" ".join(q))
    s = quote_plus(start_iso); e = quote_plus(end_iso)
    issues_url = f"https://sentry.io/organizations/{org}/issues/?project={project_id}&query={qstr}&start={s}&end={e}"
    return {"dashboard": dash, "issues": issues_url}

def build_slack_blocks(release_label: str,
                       window_label: str,
                       snapshot: Dict[str,int],
                       deltas: Dict[str,int],
                       cumuls: Dict[str,int],
                       top5: List[Dict[str,Any]],
                       action_urls: Dict[str,str],
                       cadence_label: str) -> List[Dict[str,Any]]:
    blocks: List[Dict[str,Any]] = []
    blocks.append({"type":"header","text":{"type":"plain_text","text": f"🚀 릴리즈 모니터링 — {release_label}", "emoji": True}})
    blocks.append({"type":"context","elements":[{"type":"mrkdwn","text": f"*집계 구간*: {window_label} · *주기*: {cadence_label}"}]})

    ev, isss, us = snapshot["events"], snapshot["issues"], snapshot["users"]
    ev_d = deltas.get("events",0); is_d = deltas.get("issues",0); us_d = deltas.get("users",0)
    ev_c = cumuls.get("events",0); is_c = cumuls.get("issues",0); us_c = cumuls.get("users",0)

    def line(name, cur, dlt, unit, cumul_target):
        em = diff_emoji(dlt)
        sign = f"{dlt:+d}{unit}" if dlt!=0 else f"{dlt}{unit}"
        return f"• {name}: {cur}{unit}  · 변화: {em} {sign}  · 누적: {cumul_target}{unit}"

    summary = [
        bold(":memo: 스냅샷 요약"),
        line("💥 *이벤트*", ev, ev_d, "건", ev_c),
        line("🐞 *유니크 이슈*", isss, is_d, "개", is_c),
        line("👥 *영향 사용자*", us, us_d, "명", us_c),
    ]
    blocks.append({"type":"section","text":{"type":"mrkdwn","text":"\n".join(summary)}})

    if top5:
        blocks.append({"type":"section","text":{"type":"mrkdwn","text": bold(":sports_medal: 윈도우 Top5 이슈")}})
        lines = []
        for it in top5:
            title = truncate(it.get("title"), TITLE_MAX)
            head = f"• <{it.get('link')}|{title}> · {it.get('events',0)}건 · {it.get('users',0)}명"
            lines.append(head)
        blocks.append({"type":"section","text":{"type":"mrkdwn","text":"\n".join(lines)}})

    # 액션 버튼
    blocks.append({"type":"actions","elements":[
        {"type":"button","text":{"type":"plain_text","text":"📊 대시보드 열기"},"url": action_urls["dashboard"]},
        {"type":"button","text":{"type":"plain_text","text":"🔎 이 구간 이슈 보기"},"url": action_urls["issues"]},
    ]})

    return blocks

def post_slack(webhook: str, blocks: List[Dict[str,Any]]) -> None:
    payload = {"blocks": blocks}
    r = requests.post(webhook, headers={"Content-Type":"application/json"}, data=json.dumps(payload), timeout=30)
    try:
        r.raise_for_status()
        print("[Slack] 전송 완료.")
    except requests.HTTPError as e:
        print(f"[Slack] Post failed {r.status_code}: {r.text[:300]}")
        raise

# ---- 모니터 런타임 ----
def create_monitor(platform: str, base_release: str, days: int=7) -> Dict[str,Any]:
    mid = str(uuid.uuid4())
    now = now_utc()
    rec = {
        "id": mid,
        "platform": platform,
        "base_release": base_release,  # 사용자가 입력한 semver core
        "matched_release": None,       # tick에서 채워짐
        "started_at": to_iso(now),
        "expires_at": to_iso(now + timedelta(days=days)),
        "last_run_at": None,
        "last_window_end": None,
        "cumul": {"events": 0, "issues": 0, "users": 0},
        "last_snapshot": {"events": 0, "issues": 0, "users": 0},
    }
    return rec

def pick_cadence(rec: Dict[str,Any]) -> Tuple[timedelta, str]:
    start = from_iso(rec["started_at"])
    elapsed = now_utc() - start
    if elapsed <= timedelta(days=1):
        return timedelta(minutes=30), "30분"
    return timedelta(hours=1), "1시간"

def compute_window(rec: Dict[str,Any]) -> Tuple[datetime, datetime]:
    """last_window_end 이후 ~ now, 단 최소 5분/최대 2시간 가드"""
    nowt = now_utc()
    last_end = from_iso(rec["last_window_end"]) if rec.get("last_window_end") else None
    if last_end:
        start = last_end
    else:
        base, _ = pick_cadence(rec)
        start = nowt - base
    # 가드
    if nowt - start < timedelta(minutes=5):
        start = nowt - timedelta(minutes=5)
    if nowt - start > timedelta(hours=2):
        start = nowt - timedelta(hours=2)
    return start, nowt

# ---- 명령: start / tick ----
def cmd_start(args: List[str]) -> None:
    import argparse
    TOTAL = 6
    pstep("Monitor-Start", 1, TOTAL, "dotenv 로드…")
    load_dotenv()

    p = argparse.ArgumentParser()
    p.add_argument("--platform", required=True, choices=["android","ios"])
    p.add_argument("--base-release", required=True, help="예: 4.69.0 (semver core)")
    p.add_argument("--days", type=int, default=7)

    pstep("Monitor-Start", 2, TOTAL, "인자 파싱…")
    ns = p.parse_args(args)

    pstep("Monitor-Start", 3, TOTAL, "상태 파일 로드…")
    st = load_state()

    pstep("Monitor-Start", 4, TOTAL, "모니터 레코드 생성…")
    rec = create_monitor(ns.platform, ns.base_release, ns.days)
    st["monitors"].append(rec)

    pstep("Monitor-Start", 5, TOTAL, f"상태 저장 → {STATE_PATH}")
    save_state(st)

    pstep("Monitor-Start", 6, TOTAL, f"완료: id={rec['id']}, base_release={rec['base_release']}, 만료={rec['expires_at']}")

def cmd_tick(args: List[str]) -> None:
    TOTAL = 12
    pstep("Monitor-Tick", 1, TOTAL, "dotenv 로드…")
    load_dotenv()

    # 필수 ENV
    pstep("Monitor-Tick", 2, TOTAL, "환경 변수 수집…")
    token = (getenv_clean("SENTRY_AUTH_TOKEN") or "").strip()
    org   = (getenv_clean("SENTRY_ORG_SLUG") or "").strip()
    project_slug = (getenv_clean("SENTRY_PROJECT_SLUG") or "").strip()
    project_id_env = (getenv_clean("SENTRY_PROJECT_ID") or "").strip()
    environment = (getenv_clean("SENTRY_ENVIRONMENT") or "").strip() or None
    webhook = (getenv_clean("SLACK_MONITORING_WEBHOOK_URL") or "").strip()

    if not token or not org or (not project_slug and not project_id_env) or not webhook:
        raise SystemExit("필수 ENV 누락: SENTRY_AUTH_TOKEN / SENTRY_ORG_SLUG / (SENTRY_PROJECT_ID|SENTRY_PROJECT_SLUG) / SLACK_MONITORING_WEBHOOK_URL")

    pstep("Monitor-Tick", 3, TOTAL, f"프로젝트 확인/해결(org={org}, slug={project_slug or '-'}, id_env={project_id_env or '-'})…")
    project_id = resolve_project_id(token, org, project_slug or None, project_id_env or None)
    psub("Monitor-Tick", f"project_id={project_id}")

    pstep("Monitor-Tick", 4, TOTAL, "상태 파일 로드…")
    st = load_state()
    mons: List[Dict[str,Any]] = st.get("monitors", [])
    if not mons:
        psub("Monitor-Tick", "활성 모니터가 없습니다.")
        return

    pstep("Monitor-Tick", 5, TOTAL, "만료 모니터 제외…")
    nowi = now_utc()
    active: List[Dict[str,Any]] = []
    for m in mons:
        exp = from_iso(m["expires_at"])
        if nowi <= exp:
            active.append(m)
        else:
            psub("Monitor-Tick", f"만료됨 → id={m['id']} base={m['base_release']}")

    if not active:
        psub("Monitor-Tick", "활성 모니터 없음(모두 만료). 상태 저장 후 종료.")
        st["monitors"] = mons
        save_state(st)
        return

    pstep("Monitor-Tick", 6, TOTAL, f"활성 모니터 처리 시작 (총 {len(active)}개)…")

    for idx, m in enumerate(active, start=1):
        prefix = f"Monitor-Tick:{idx}/{len(active)}"
        psub(prefix, f"대상 id={m['id']} base={m['base_release']} platform={m.get('platform')}")
        # 릴리즈 매칭
        psub(prefix, "base→full 버전 매칭 시도…")
        base = m["base_release"]
        full = m.get("matched_release") or match_full_release(token, org, project_id, base)
        if not full:
            psub(prefix, f"매칭 실패 → 스킵(base={base})")
            continue
        m["matched_release"] = full
        psub(prefix, f"매칭 결과 full={full}")

        # 릴리즈 기준 시간
        psub(prefix, "릴리즈 기준 시간 조회…")
        rel_created = get_release_created_at(token, org, project_id, full)
        rel_label = f"{full} (기준시: {to_iso(rel_created) if rel_created else 'N/A'})"

        # 집계 창 계산
        psub(prefix, "집계 윈도우 계산…")
        win_s, win_e = compute_window(m)
        win_s_iso, win_e_iso = to_iso(win_s), to_iso(win_e)
        win_label = f"{win_s.astimezone(KST).strftime('%Y-%m-%d %H:%M')} ~ {win_e.astimezone(KST).strftime('%Y-%m-%d %H:%M')} (KST)"
        cad_td, cad_label = pick_cadence(m)
        psub(prefix, f"window={win_s_iso} ~ {win_e_iso} · cadence={cad_label}")

        # 스냅샷 집계
        psub(prefix, "스냅샷 집계(events/issues/users)…")
        snap = window_aggregates(token, org, project_id, environment, full, win_s_iso, win_e_iso)
        psub(prefix, f"snapshot={snap}")

        # 상위 이슈
        psub(prefix, f"Top{TOP_LIMIT} 이슈 수집…")
        top5 = window_top_issues(token, org, project_id, environment, full, win_s_iso, win_e_iso, TOP_LIMIT)
        psub(prefix, f"top_count={len(top5)}")

        # 델타/누적
        last_snap = m.get("last_snapshot") or {"events":0,"issues":0,"users":0}
        delta = {
            "events": snap["events"] - last_snap.get("events",0),
            "issues": snap["issues"] - last_snap.get("issues",0),
            "users":  snap["users"]  - last_snap.get("users",0),
        }
        cumul = m.get("cumul") or {"events":0,"issues":0,"users":0}
        cumul = {
            "events": cumul.get("events",0) + snap["events"],
            "issues": cumul.get("issues",0) + snap["issues"],
            "users":  cumul.get("users",0)  + snap["users"],
        }
        psub(prefix, f"delta={delta} · cumul={cumul}")

        # 액션 URL/Slack 전송
        psub(prefix, "액션 URL 생성(dashboard/issues)…")
        actions = build_action_urls(org, project_id, environment, full, win_s_iso, win_e_iso)
        psub(prefix, "Slack 전송…")
        try:
            blocks = build_slack_blocks(release_label=rel_label,
                                        window_label=win_label,
                                        snapshot=snap, deltas=delta, cumuls=cumul,
                                        top5=top5, action_urls=actions, cadence_label=cad_label)
            post_slack(webhook, blocks)
        except Exception as e:
            psub(prefix, f"Slack 전송 실패(무시하고 상태 갱신): {e}")

        # 상태 업데이트
        psub(prefix, "상태 업데이트…")
        m["last_run_at"] = to_iso(now_utc())
        m["last_window_end"] = win_e_iso
        m["last_snapshot"] = snap
        m["cumul"] = cumul
        psub(prefix, "완료")

    pstep("Monitor-Tick", 7, TOTAL, "상태 저장…")
    st["monitors"] = mons
    save_state(st)

    pstep("Monitor-Tick", 12, TOTAL, "모든 활성 모니터 처리 완료.")

# ---- 엔트리 ----
def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("start","tick"):
        print("Usage:")
        print("  python sentry_release_monitor.py start --platform {android|ios} --base-release 4.69.0 [--days 7]")
        print("  python sentry_release_monitor.py tick")
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == "start":
        cmd_start(sys.argv[2:])
    else:
        cmd_tick(sys.argv[2:])

if __name__ == "__main__":
    main()