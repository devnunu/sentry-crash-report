#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sentry 주간 리포트 (지난주 월~일, 한국시간 기준)
- 이벤트/이슈/영향 사용자 주간 합계 + Crash Free(주간 평균)
- 이벤트 기준 상위 5개 이슈 (전주 대비를 같은 줄에 표기)
- 주간 신규 발생 이슈(선택적 제한)
- 주간 급증(서지) 이슈 (간단 베이스라인)
- 최신 릴리즈 1개(정규 semver 최대) 기준:
  • 사라진 이슈 (post 7일 0건 + 현재 resolved)
  • 많이 감소한 이슈 (전후 7일 -80%p 이상)
- Slack Webhook으로 전송 가능

동작 가정:
- 월요일 오전 9시에 실행하여 지난주(월~일) 통계를 전달
"""

import json
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote_plus

import math
import requests
from dotenv import load_dotenv
from packaging.version import Version, InvalidVersion

API_BASE = "https://sentry.io/api/0"

# ====== 타임존 ======
try:
    from zoneinfo import ZoneInfo  # py3.9+
except Exception:  # pragma: no cover
    from backports.zoneinfo import ZoneInfo  # type: ignore

KST = ZoneInfo("Asia/Seoul")
UTC = timezone.utc

# ====== 공통 임계치/표시 상수 ======
TITLE_MAX = 90
WEEKLY_TOP_LIMIT = 5
WEEKLY_NEW_LIMIT = 10
WEEKLY_SURGE_LIMIT = 10

# 주간 신규/해결/묵은 이슈 임계
WEEKLY_RESOLVED_MIN_EVENTS = 20
WEEKLY_RESOLVED_MIN_USERS  = 10

WEEKLY_STALE_MIN_AGE_DAYS  = 30
WEEKLY_STALE_MIN_EVENTS    = 5
WEEKLY_STALE_MIN_USERS     = 3
WEEKLY_STALE_LIMIT         = 20

# 급증(서지) 간단 판정
WEEKLY_SURGE_MIN_EVENTS         = 50
WEEKLY_SURGE_GROWTH_MULTIPLIER  = 2.0  # 전주 대비 2배 이상
WEEKLY_SURGE_Z_THRESHOLD        = 2.0
WEEKLY_SURGE_MAD_THRESHOLD      = 3.5
WEEKLY_BASELINE_WEEKS           = 4    # 지난 4주 베이스라인 (전주 포함)

# 최신 릴리즈 영향 측정
RELEASE_FIX_IMPROVEMENT_DROP_PCT = 80.0   # -80%p 이상 감소
RELEASE_FIXES_MIN_BASE_EVENTS     = 10    # 전 7일 최소 베이스
WEEKLY_RELEASE_FIXES_PER_RELEASE_LIMIT = 20

# semver(+build) 허용: 4.68.0 / 4.68.0+908 허용, 4.62.0.0-foo+20 제외
SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+(?:\+\d+)?$")

# Discover 공통
LEVEL_QUERY = "level:[error,fatal]"

# =============== 로그 유틸 ===============
def wlog(msg: str) -> None:
    print(f"[Weekly] {msg}")

# =============== 유틸 ===============
def bold(s: str) -> str:
    return f"*{s}*"

def truncate(s: Optional[str], n: int) -> str:
    if not s:
        return "(제목 없음)"
    return s if len(s) <= n else s[: n - 1] + "…"

def ensure_ok(r: requests.Response) -> requests.Response:
    try:
        r.raise_for_status()
    except requests.HTTPError as e:
        msg = f"HTTP {r.status_code} for {r.request.method} {r.url}\nResponse: {r.text[:800]}"
        raise SystemExit(msg) from e
    return r

def auth_headers(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}

def date_kst(d: datetime) -> datetime:
    return d.astimezone(KST)

def to_utc_iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat().replace("+00:00","Z")

def parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z","+00:00"))

def kst_week_bounds_for_last_week(today_kst: datetime) -> Tuple[datetime, datetime]:
    """
    today_kst 기준 '지난주 월 00:00:00' ~ '지난주 일 23:59:59.999' 경계를 반환
    - 월요일 실행을 가정하지만, 어떤 요일에 실행해도 '완료된 지난 주'를 고정 반환
    """
    dow = today_kst.weekday()  # Mon=0
    this_mon = today_kst.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=dow)
    last_mon = this_mon - timedelta(days=7)
    last_sun_end = this_mon - timedelta(microseconds=1)
    return last_mon, last_sun_end

def kst_week_bounds_for_prev_prev_week(today_kst: datetime) -> Tuple[datetime, datetime]:
    last_mon, last_sun_end = kst_week_bounds_for_last_week(today_kst)
    prev_last_mon = last_mon - timedelta(days=7)
    prev_last_sun_end = last_mon - timedelta(microseconds=1)
    return prev_last_mon, prev_last_sun_end

def pretty_kst_date(d: datetime) -> str:
    return d.strftime("%Y-%m-%d")

def pretty_kst_range(start_kst: datetime, end_kst: datetime) -> str:
    s = start_kst.strftime("%Y-%m-%d")
    e = end_kst.strftime("%Y-%m-%d")
    return f"{s} ~ {e} (KST)"

def diff_line(cur: int, prev: int, unit: str="건") -> str:
    delta = cur - prev
    if delta > 0:
        arrow = ":small_red_triangle:"
    elif delta < 0:
        arrow = ":small_red_triangle_down:"
    else:
        arrow = "—"
    ratio = f" ({(delta/prev)*100:+.1f}%)" if prev > 0 else ""
    return f"{cur}{unit} -> 전주 대비: {arrow}{abs(delta)}{unit}{ratio}"

# 추가: 컴팩트 전주대비 포맷 (현재값 + 중간점 + 증감/퍼센트)
def diff_compact(cur: int, prev: int, unit: str="건") -> str:
    delta = cur - prev
    if delta > 0:
        arrow = ":small_red_triangle:"
    elif delta < 0:
        arrow = ":small_red_triangle_down:"
    else:
        arrow = "—"
    ratio = f" ({(delta/prev)*100:+.1f}%)" if prev > 0 else ""
    # '  · ' 사이에 공백 두 칸 + 중간점 유지 (요청 포맷)
    return f"{cur}{unit}  · {arrow}{abs(delta)}{unit}{ratio}"

# =========== HTTP 페이징 유틸 ===========
def parse_next_cursor(link_header: str) -> Optional[str]:
    """
    Link 헤더에서 rel="next"의 cursor만 안전 추출
    """
    if not link_header:
        return None
    parts = [p.strip() for p in link_header.split(",")]
    for p in parts:
        if 'rel="next"' not in p:
            continue
        if 'results="false"' in p:
            return None
        m = re.search(r'cursor="([^"]+)"', p)
        if m:
            cur = m.group(1)
            if ":-1:" in cur:
                return None
            return cur
        m2 = re.search(r'cursor=([^;>]+)', p)
        if m2:
            cur = m2.group(1)
            if ":-1:" in cur:
                return None
            return cur
    return None

# =========== 프로젝트/릴리즈 ===========
def resolve_project_id(token: str, org: str, project_slug: Optional[str], project_id_env: Optional[str]) -> int:
    if project_id_env:
        return int(project_id_env)
    if not project_slug:
        raise SystemExit("SENTRY_PROJECT_SLUG 또는 SENTRY_PROJECT_ID 중 하나는 필요합니다.")
    wlog("[3/13] 프로젝트 ID 확인 중…")
    url = f"{API_BASE}/organizations/{org}/projects/"
    r = ensure_ok(requests.get(url, headers=auth_headers(token), timeout=30))
    for p in r.json():
        if p.get("slug") == project_slug:
            pid = int(p.get("id"))
            wlog(f"[3/13] 프로젝트 '{project_slug}' → ID={pid}")
            return pid
    raise SystemExit(f"'{project_slug}' 프로젝트를 찾을 수 없습니다.")

def list_releases_paginated(token: str, org: str, project_id: int, per_page: int=100, max_pages: int=20) -> List[Dict[str, Any]]:
    wlog("[10/13] 릴리즈 목록 수집 시작…")
    url = f"{API_BASE}/organizations/{org}/releases/"
    headers = auth_headers(token)
    out: List[Dict[str, Any]] = []
    cursor: Optional[str] = None
    pages = 0
    while True:
        pages += 1
        params = {"project": project_id, "per_page": min(max(per_page,1),100)}
        if cursor:
            params["cursor"] = cursor
        r = ensure_ok(requests.get(url, headers=headers, params=params, timeout=60))
        data = r.json() or []
        out.extend(data)
        wlog(f"[10/13] 릴리즈 페이지 {pages}: {len(data)}개")
        cursor = parse_next_cursor(r.headers.get("link",""))
        if not cursor or pages >= max_pages or not data:
            break
    wlog(f"[10/13] 릴리즈 총 {len(out)}개 수집 완료")
    return out

def latest_release_version(token: str, org: str, project_id: int) -> Optional[str]:
    wlog("[11/13] 최신 릴리즈(semver) 선택 시작…")
    rels = list_releases_paginated(token, org, project_id)
    cands: List[Tuple[Version,str]] = []
    for r in rels:
        name = str(r.get("version") or r.get("shortVersion") or "").strip()
        if not name or not SEMVER_RE.match(name):
            continue
        try:
            base = name.split("+")[0]
            cands.append((Version(base), name))
        except InvalidVersion:
            continue
    if not cands:
        wlog("[11/13] 정규 semver 릴리즈 없음")
        return None
    cands.sort(key=lambda x: x[0], reverse=True)
    best = cands[0][1]
    wlog(f"[11/13] 최신 릴리즈: {best}")
    return best

# =========== Discover/Issues 집계 ===========
def discover_aggregates(token: str, org: str, project_id: int, environment: Optional[str], start_iso: str, end_iso: str) -> Dict[str, int]:
    wlog("[4/13] 주간 합계 집계(이벤트/이슈/사용자)…")
    url = f"{API_BASE}/organizations/{org}/events/"
    query = f"{LEVEL_QUERY}" + (f" environment:{environment}" if environment else "")
    params = {
        "field": ["count()", "count_unique(issue)", "count_unique(user)"],
        "project": project_id,
        "start": start_iso,
        "end": end_iso,
        "query": query,
        "referrer": "api.weekly.aggregates",
    }
    r = ensure_ok(requests.get(url, headers=auth_headers(token), params=params, timeout=60))
    rows = (r.json().get("data") or [])
    if not rows:
        wlog("  - 집계 없음 (0,0,0)")
        return {"events": 0, "issues": 0, "users": 0}
    row0 = rows[0]
    out = {
        "events": int(row0.get("count()") or 0),
        "issues": int(row0.get("count_unique(issue)") or 0),
        "users": int(row0.get("count_unique(user)") or 0),
    }
    wlog(f"  - events={out['events']} / issues={out['issues']} / users={out['users']}")
    return out

def sessions_crash_free_weekly_avg(token: str, org: str, project_id: int, environment: Optional[str], start_iso: str, end_iso: str) -> Tuple[Optional[float], Optional[float]]:
    wlog("[5/13] Crash Free(주간 평균) 집계…")
    url = f"{API_BASE}/organizations/{org}/sessions/"
    params = {
        "project": project_id,
        "start": start_iso,
        "end": end_iso,
        "interval": "1d",
        "field": ["crash_free_rate(session)", "crash_free_rate(user)"],
        "referrer": "api.weekly.sessions",
    }
    if environment:
        params["environment"] = environment
    r = ensure_ok(requests.get(url, headers=auth_headers(token), params=params, timeout=60))
    data = r.json() or {}
    days = 0
    sum_s = 0.0
    sum_u = 0.0
    for g in data.get("groups", []):
        series = g.get("series", {})
        if "crash_free_rate(session)" in series:
            arr = series["crash_free_rate(session)"] or []
            if arr:
                sum_s += sum(arr)
                days = max(days, len(arr))
        if "crash_free_rate(user)" in series:
            arr = series["crash_free_rate(user)"] or []
            if arr:
                sum_u += sum(arr)
                days = max(days, len(arr))
    avg_s = (sum_s / days) if days > 0 else None
    avg_u = (sum_u / days) if days > 0 else None
    wlog(f"  - crash_free(session)={fmt_pct_trunc2(avg_s)} / crash_free(user)={fmt_pct_trunc2(avg_u)}")
    return avg_s, avg_u

def discover_issue_table(token: str, org: str, project_id: int, environment: Optional[str],
                         start_iso: str, end_iso: str, orderby: str="-count()", limit: int=50) -> List[Dict[str, Any]]:
    url = f"{API_BASE}/organizations/{org}/events/"
    query = f"{LEVEL_QUERY}" + (f" environment:{environment}" if environment else "")
    params = {
        "field": ["issue.id", "issue", "title", "count()", "count_unique(user)"],
        "project": project_id,
        "start": start_iso,
        "end": end_iso,
        "query": query,
        "orderby": orderby,
        "per_page": min(max(limit, 1), 100),
        "referrer": "api.weekly.issue-table",
    }
    r = ensure_ok(requests.get(url, headers=auth_headers(token), params=params, timeout=60))
    rows = r.json().get("data") or []
    out = []
    for row in rows[:limit]:
        iid_num = str(row.get("issue.id") or "")
        short = row.get("issue")
        out.append({
            "issue_id": iid_num,
            "short_id": short,
            "title": row.get("title"),
            "events": int(row.get("count()") or 0),
            "users": int(row.get("count_unique(user)") or 0),
            "link": f"https://sentry.io/organizations/{org}/issues/{iid_num}/" if iid_num else None,
        })
    return out

def issues_search(token: str, org: str, project_id: int, query: str, since_iso: Optional[str], until_iso: Optional[str], per_page: int=100) -> List[Dict[str, Any]]:
    url = f"{API_BASE}/organizations/{org}/issues/"
    headers = auth_headers(token)
    params = {
        "project": project_id,
        "query": query,
        "per_page": min(max(per_page,1),100),
        "referrer": "api.weekly.issues-search",
    }
    if since_iso: params["since"] = since_iso
    if until_iso: params["until"] = until_iso
    out: List[Dict[str, Any]] = []
    cursor: Optional[str] = None
    pages = 0
    while True:
        pages += 1
        if cursor:
            params["cursor"] = cursor
        r = ensure_ok(requests.get(url, headers=headers, params=params, timeout=60))
        arr = r.json() or []
        out.extend(arr)
        cursor = parse_next_cursor(r.headers.get("link",""))
        if not cursor or not arr:
            break
    return out

def count_for_issues_in_window(token: str, org: str, project_id: int, environment: Optional[str],
                               issue_ids: List[str], start_iso: str, end_iso: str) -> Dict[str, Dict[str,int]]:
    if not issue_ids:
        return {}
    url = f"{API_BASE}/organizations/{org}/events/"
    query = f"{LEVEL_QUERY}" + (f" environment:{environment}" if environment else "")
    params = {
        "field": ["issue.id", "count()", "count_unique(user)"],
        "project": project_id,
        "start": start_iso,
        "end": end_iso,
        "query": query + f" issue.id:[{','.join(issue_ids)}]",
        "orderby": "-count()",
        "per_page": 100,
        "referrer": "api.weekly.issue-bulk-counts",
    }
    r = ensure_ok(requests.get(url, headers=auth_headers(token), params=params, timeout=60))
    rows = r.json().get("data") or []
    out: Dict[str, Dict[str,int]] = {}
    for row in rows:
        iid = str(row.get("issue.id"))
        out[iid] = {
            "events": int(row.get("count()") or 0),
            "users": int(row.get("count_unique(user)") or 0),
        }
    return out

# =========== 통계 유틸 ===========
def mean_std(values: List[float]) -> Tuple[float, float]:
    if not values:
        return 0.0, 0.0
    m = sum(values)/len(values)
    var = sum((v-m)**2 for v in values) / len(values)
    return m, math.sqrt(var)

def median(values: List[float]) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    n = len(s)
    mid = n//2
    if n % 2 == 1:
        return float(s[mid])
    return (s[mid-1] + s[mid]) / 2.0

def mad(values: List[float], med: Optional[float]=None) -> float:
    if not values:
        return 0.0
    m = med if med is not None else median(values)
    dev = [abs(v - m) for v in values]
    return median(dev)

# =========== 주간 기능: 신규/급증/해결/묵은 ===========
def new_issues_in_week(token: str, org: str, project_id: int, environment: Optional[str], start_iso: str, end_iso: str, limit: int=WEEKLY_NEW_LIMIT) -> List[Dict[str, Any]]:
    wlog("[7/13] 주간 신규 발생 이슈 수집…")
    q = [LEVEL_QUERY, f"firstSeen:>={start_iso}", f"firstSeen:<{end_iso}"]
    if environment:
        q.append(f"environment:{environment}")
    items = issues_search(token, org, project_id, " ".join(q), since_iso=start_iso, until_iso=end_iso, per_page=100)
    out = []
    for it in items[:limit]:
        iid = it.get("id")
        out.append({
            "issue_id": iid,
            "title": it.get("title"),
            "count": int(it.get("count") or 0),
            "first_seen": it.get("firstSeen"),
            "link": it.get("permalink") or (f"https://sentry.io/organizations/{org}/issues/{iid}/" if iid else None)
        })
    wlog(f"[7/13] 신규 이슈 {len(out)}개")
    return out

def detect_weekly_surge(token: str, org: str, project_id: int, environment: Optional[str],
                        this_start_iso: str, this_end_iso: str, prev_start_iso: str, prev_end_iso: str) -> List[Dict[str, Any]]:
    """
    간단 주간 서지: 이번주 vs 전주, + 지난 4주(전주 포함) 베이스라인으로 Z/MAD 체크
    """
    wlog("[7/13] 주간 급증(서지) 이슈 탐지…")
    this_top = discover_issue_table(token, org, project_id, environment, this_start_iso, this_end_iso, "-count()", 100)
    prev_top = discover_issue_table(token, org, project_id, environment, prev_start_iso, prev_end_iso, "-count()", 100)

    this_map = {str(x["issue_id"]): x for x in this_top}
    prev_map = {str(x["issue_id"]): x for x in prev_top}

    # 베이스라인: 지난 4주(전주 포함)의 weekly events
    baselines: Dict[str, List[int]] = {iid: [] for iid in set(list(this_map.keys()) + list(prev_map.keys()))}

    # 이번주 기준 종료일의 직전 주부터 4주 수집
    end_dt = parse_iso(this_end_iso)
    for w in range(1, WEEKLY_BASELINE_WEEKS+1):
        w_end = (end_dt - timedelta(days=7*w))
        w_start = w_end - timedelta(days=6, hours=23, minutes=59, seconds=59, microseconds=999999)
        w_s_iso = to_utc_iso(w_start)
        w_e_iso = to_utc_iso(w_end)
        rows = discover_issue_table(token, org, project_id, environment, w_s_iso, w_e_iso, "-count()", 200)
        wmap = {str(r["issue_id"]): r for r in rows}
        for iid in baselines.keys():
            baselines[iid].append(int(wmap.get(iid, {}).get("events", 0)))

    out: List[Dict[str, Any]] = []
    for iid, it in this_map.items():
        cur = int(it.get("events", 0))
        if cur < WEEKLY_SURGE_MIN_EVENTS:
            continue
        prev = int(prev_map.get(iid, {}).get("events", 0))
        growth = (cur / max(prev, 1))
        base_vals = [float(x) for x in baselines.get(iid, []) if isinstance(x,(int,float))]
        m, s = mean_std(base_vals)
        med = median(base_vals)
        m_mad = mad(base_vals, med)
        eps = 1e-9
        z = (cur - m) / (s + eps) if s > 0 else (float("inf") if cur > m else 0.0)
        mad_s = (cur - med) / (1.4826 * m_mad + eps) if m_mad > 0 else (float("inf") if cur > med else 0.0)

        conds = {
            "growth": growth >= WEEKLY_SURGE_GROWTH_MULTIPLIER,
            "zscore": z >= WEEKLY_SURGE_Z_THRESHOLD,
            "madscore": mad_s >= WEEKLY_SURGE_MAD_THRESHOLD,
        }
        if any(conds.values()):
            out.append({
                "issue_id": iid,
                "title": it.get("title"),
                "event_count": cur,
                "prev_count": prev,
                "growth_multiplier": round(growth, 2),
                "zscore": None if math.isinf(z) else round(z, 2),
                "mad_score": None if math.isinf(mad_s) else round(mad_s, 2),
                "link": it.get("link"),
                "reasons": [k for k,v in conds.items() if v]
            })
    out.sort(key=lambda x: (x["event_count"], (x["zscore"] or 0), (x["mad_score"] or 0), x["growth_multiplier"]), reverse=True)
    wlog(f"[7/13] 급증 이슈 {len(out)}개")
    return out[:WEEKLY_SURGE_LIMIT]

def fetch_issue_detail(token: str, org: str, issue_key: str) -> Dict[str, Any]:
    """
    issue_key가 숫자형이면 바로 /issues/{id}/
    숫자가 아니면 shortId로 검색해서 숫자형 id로 재조회
    """
    headers = auth_headers(token)

    if issue_key.isdigit():
        url = f"{API_BASE}/issues/{issue_key}/"
        r = ensure_ok(requests.get(url, headers=headers, timeout=30))
        return r.json() or {}

    search_url = f"{API_BASE}/organizations/{org}/issues/"
    params = {
        "query": f"shortId:{issue_key}",
        "per_page": 1,
        "referrer": "api.weekly.issue-detail-resolve",
    }
    r = ensure_ok(requests.get(search_url, headers=headers, params=params, timeout=30))
    arr = r.json() or []
    if not arr:
        raise SystemExit(f"이슈 shortId '{issue_key}'를 숫자형 ID로 해석할 수 없습니다.")
    numeric_id = str(arr[0].get("id") or "")
    if not numeric_id:
        raise SystemExit(f"shortId '{issue_key}' 응답에 숫자형 id가 없습니다.")

    url = f"{API_BASE}/issues/{numeric_id}/"
    r = ensure_ok(requests.get(url, headers=headers, timeout=30))
    return r.json() or {}

def release_fixes_in_week(token: str, org: str, project_id: int, environment: Optional[str],
                          week_start_iso: str, week_end_iso: str) -> List[Dict[str, Any]]:
    """
    최신(semver 최댓값) 릴리즈 1개만 대상으로 전/후 7일 비교:
      - 사라진 이슈: post 7일 0건 AND 현재 status=resolved
      - 많이 감소한 이슈: post>0 AND 전후 -80%p 이상 감소
    """
    wlog("[12/13] 최신 릴리즈 개선 감지 시작…")
    best_rel = latest_release_version(token, org, project_id)
    if not best_rel:
        wlog("[12/13] 최신 릴리즈 없음")
        return []

    wlog("[12/13] 전후 비교 대상(이벤트 Top50) 수집…")
    top_e = discover_issue_table(token, org, project_id, environment, week_start_iso, week_end_iso, "-count()", 50)
    pool = {it["issue_id"]: it for it in top_e if it.get("issue_id")}
    ids = list(pool.keys())
    if not pool:
        wlog("[12/13] 비교 대상 없음")
        return [{"release": best_rel, "disappeared": [], "decreased": []}]

    week_end_dt = parse_iso(week_end_iso)
    pivot = week_end_dt - timedelta(days=1)
    pre_start = to_utc_iso(pivot - timedelta(days=7))
    pre_end   = to_utc_iso(pivot)
    post_start= to_utc_iso(pivot + timedelta(seconds=1))
    post_end  = to_utc_iso(pivot + timedelta(days=7))

    wlog("[12/13] 전기간 집계…")
    pre_map  = count_for_issues_in_window(token, org, project_id, environment, ids, pre_start, pre_end)
    wlog("[12/13] 후기간 집계…")
    post_map = count_for_issues_in_window(token, org, project_id, environment, ids, post_start, post_end)

    disappeared: List[Dict[str, Any]] = []
    decreased:   List[Dict[str, Any]] = []

    wlog("[12/13] 전/후 비교 판정…")
    for iid in ids:
        pre_ev  = int(pre_map.get(iid, {}).get("events", 0))
        post_ev = int(post_map.get(iid, {}).get("events", 0))
        if pre_ev < RELEASE_FIXES_MIN_BASE_EVENTS:
            continue
        status = None
        try:
            status = (fetch_issue_detail(token, iid).get("status") or "").lower()
        except Exception:
            pass
        drop_pct = 100.0*(pre_ev - post_ev)/pre_ev if pre_ev>0 else 0.0

        if post_ev == 0 and status == "resolved":
            disappeared.append({
                "issue_id": iid,
                "title": pool[iid].get("title"),
                "pre_7d_events": pre_ev,
                "post_7d_events": post_ev,
                "link": pool[iid].get("link"),
            })
            continue

        if post_ev > 0 and drop_pct >= RELEASE_FIX_IMPROVEMENT_DROP_PCT:
            decreased.append({
                "issue_id": iid,
                "title": pool[iid].get("title"),
                "pre_7d_events": pre_ev,
                "post_7d_events": post_ev,
                "delta_pct": round(-drop_pct, 1),
                "link": pool[iid].get("link"),
            })

    disappeared.sort(key=lambda x: x["pre_7d_events"], reverse=True)
    decreased.sort(key=lambda x: (x["delta_pct"], -x["post_7d_events"]), reverse=True)
    wlog(f"[12/13] 최신 '{best_rel}' → 사라진:{len(disappeared)} / 감소:{len(decreased)}")
    return [{
        "release": best_rel,
        "disappeared": disappeared[:WEEKLY_RELEASE_FIXES_PER_RELEASE_LIMIT],
        "decreased":   decreased[:WEEKLY_RELEASE_FIXES_PER_RELEASE_LIMIT],
    }]

def build_sentry_action_urls(
    org: str,
    project_id: int,
    environment: Optional[str],
    start_iso_utc: str,
    end_iso_utc: str,
) -> Dict[str, str]:
    """
    - dashboard_url: SENTRY_DASHBOARD_URL > DASH_BOARD_ID > 조직 프로젝트 목록 순으로 선택
    - issues_filtered_url: 분석 구간(start/end) + level(error,fatal) + environment 쿼리가 적용된 이슈 목록
    """
    # 1) 대시보드 URL
    env_dash = os.getenv("SENTRY_DASHBOARD_URL")
    dash_id  = os.getenv("DASH_BOARD_ID")
    if env_dash:
        dashboard_url = env_dash
    elif dash_id:
        dashboard_url = f"https://sentry.io/organizations/{org}/dashboard/{dash_id}/?project={project_id}"
        # (원하시면 서브도메인 스타일도 가능: f"https://{org}.sentry.io/dashboard/{dash_id}/?project={project_id}")
    else:
        dashboard_url = f"https://sentry.io/organizations/{org}/projects/"

    # 2) 이슈 목록 URL (organizations 경로 + query + start/end)
    base = f"https://sentry.io/organizations/{org}/issues/"
    q_parts = ["level:[error,fatal]"]
    if environment:
        q_parts.append(f"environment:{environment}")
    q = quote_plus(" ".join(q_parts))
    s = quote_plus(start_iso_utc)
    e = quote_plus(end_iso_utc)
    issues_filtered_url = f"{base}?project={project_id}&query={q}&start={s}&end={e}"

    return {
        "dashboard_url": dashboard_url,
        "issues_filtered_url": issues_filtered_url,
    }

# =========== Slack 렌더링 ===========
def fmt_pct_trunc2(v: Optional[float]) -> str:
    if v is None:
        return "N/A"
    pct = v*100.0
    truncated = int(pct*100)/100
    return f"{truncated:.2f}%"

# 기존 함수 수정
def issue_line_with_prev(item: Dict[str, Any], prev_map: Dict[str, Any]) -> str:
    """
    예)
    • 제목 · 24건 · 12명  -> 전주 대비: :small_red_triangle_down:6건 (-20.0%)
    """
    title = truncate(item.get("title"), TITLE_MAX)
    link  = item.get("link")
    ev    = int(item.get("events", 0))
    us    = int(item.get("users", 0))
    head  = f"• <{link}|{title}> · {ev}건 · {us}명" if link else f"• {title} · {ev}건 · {us}명"

    prev_ev = int(prev_map.get(str(item.get("issue_id")), {}).get("events", 0))
    tail = f" -> 전주 대비: {diff_delta_only(ev, prev_ev, '건')}"
    return head + " " + tail

def diff_delta_only(cur: int, prev: int, unit: str="건") -> str:
    delta = cur - prev
    if delta > 0:
        arrow = ":small_red_triangle:"
    elif delta < 0:
        arrow = ":small_red_triangle_down:"
    else:
        arrow = "—"
    ratio = f" ({(delta/prev)*100:+.1f}%)" if prev > 0 else ""
    return f"{arrow}{abs(delta)}{unit}{ratio}"

def surge_reason_ko(reasons: List[str]) -> str:
    ko = {
        "growth": "전주 대비 급증",
        "zscore": "평균 대비 통계적 급증",
        "madscore": "중앙값 대비 이상치",
    }
    labeled = [ko.get(x, x) for x in reasons]
    return "/".join(labeled)

def build_weekly_blocks(
    payload: Dict[str, Any],
    slack_title: str,
    env_label: Optional[str],
    org: str,
    project_id: int,
    week_window_utc: Dict[str, str],
) -> List[Dict[str, Any]]:
    blocks: List[Dict[str, Any]] = []
    blocks.append({"type":"header","text":{"type":"plain_text","text": slack_title, "emoji": True}})

    sum_this = payload.get("this_week", {})
    sum_prev = payload.get("prev_week", {})

    events = int(sum_this.get("events", 0))
    issues = int(sum_this.get("issues", 0))
    users  = int(sum_this.get("users", 0))
    prev_events = int(sum_prev.get("events", 0))
    prev_issues = int(sum_prev.get("issues", 0))
    prev_users  = int(sum_prev.get("users", 0))

    cf_s = sum_this.get("crash_free_sessions")
    cf_u = sum_this.get("crash_free_users")

    summary_lines = [
        bold(":memo: Summary"),
        f"• 💥 *총 이벤트 발생 건수*: {diff_line(events, prev_events, '건')}",
        f"• 🐞 *유니크 이슈 개수*: {diff_line(issues, prev_issues, '개')}",
        f"• 👥 *영향 사용자*: {diff_line(users, prev_users, '명')}",
        f"• 🛡️ *Crash Free 세션(주간 평균)*: {fmt_pct_trunc2(cf_s)} / *Crash Free 사용자*: {fmt_pct_trunc2(cf_u)}",
    ]
    blocks.append({"type":"section","text":{"type":"mrkdwn","text":"\n".join(summary_lines)}})

    blocks.append({"type":"context","elements":[{"type":"mrkdwn","text": f"*집계 구간*: {payload.get('this_week_range_kst','?')}"}]})
    if env_label:
        blocks.append({"type":"context","elements":[{"type":"mrkdwn","text": f"*환경*: {env_label}"}]})
    blocks.append({"type":"divider"})

    top_this = payload.get("top5_events", [])
    prev_map = { str(x.get("issue_id")): x for x in payload.get("prev_top_events", []) }
    if top_this:
        blocks.append({"type":"section","text":{"type":"mrkdwn","text": bold(":sports_medal: 상위 5개 이슈(이벤트)")}})
        lines = [issue_line_with_prev(x, prev_map) for x in top_this[:WEEKLY_TOP_LIMIT]]
        blocks.append({"type":"section","text":{"type":"mrkdwn","text":"\n".join(lines)}})
        blocks.append({"type":"divider"})

    new_items = payload.get("new_issues", [])
    if new_items:
        blocks.append({"type":"section","text":{"type":"mrkdwn","text": bold(":new: 주간 신규 발생 이슈")}})
        lines = [f"• <{x.get('link')}|{truncate(x.get('title'), TITLE_MAX)}> · {x.get('count',0)}건" for x in new_items]
        blocks.append({"type":"section","text":{"type":"mrkdwn","text":"\n".join(lines)}})
        blocks.append({"type":"divider"})

    surges = payload.get("surge_issues", [])
    if surges:
        blocks.append({"type":"section","text":{"type":"mrkdwn","text": bold(":chart_with_upwards_trend: 급증(서지) 이슈")}})
        lines = []
        for s in surges:
            head = f"• <{s.get('link')}|{truncate(s.get('title'), TITLE_MAX)}> · {s.get('event_count',0)}건"
            tail = f"  ↳ 전주 {s.get('prev_count',0)}건 → 이번주 {s.get('event_count',0)}건. 판정 근거: {surge_reason_ko(s.get('reasons',[]))}"
            lines.append(head+"\n"+tail)
        blocks.append({"type":"section","text":{"type":"mrkdwn","text":"\n".join(lines)}})
        blocks.append({"type":"divider"})

    rfix = payload.get("this_week_release_fixes") or []
    if rfix:
        grp = rfix[0]
        blocks.append({"type":"section","text":{"type":"mrkdwn","text": bold("📦 최신 릴리즈에서 해소된 이슈")}})
        blocks.append({"type":"section","text":{"type":"mrkdwn","text": bold(f"• {grp.get('release')}")}})

        disappeared = grp.get("disappeared") or []
        decreased   = grp.get("decreased") or []

        if disappeared:
            rows = [bold("  ◦ 사라진 이슈(전후 7일 비교: 0건 & 현재 Resolved)")]
            for it in disappeared:
                rows.append(f"    • <{it.get('link')}|{truncate(it.get('title'), TITLE_MAX)}> — 전 7일 {it.get('pre_7d_events')}건 → 후 7일 0건")
            blocks.append({"type":"section","text":{"type":"mrkdwn","text":"\n".join(rows)}})

        if decreased:
            rows = [bold("  ◦ 많이 감소한 이슈(전후 7일 -80%p 이상)")]
            for it in decreased:
                rows.append(f"    • <{it.get('link')}|{truncate(it.get('title'), TITLE_MAX)}> — 전 7일 {it.get('pre_7d_events')}건 → 후 7일 {it.get('post_7d_events')}건 ({it.get('delta_pct')}pp)")
            blocks.append({"type":"section","text":{"type":"mrkdwn","text":"\n".join(rows)}})

        blocks.append({"type":"divider"})

    try:
        actions_block = build_footer_actions_block(org, int(project_id), env_label, week_window_utc)
        blocks.append(actions_block)
    except Exception:
        # 액션 블록 실패는 무시하고 계속 진행
        pass

    return blocks

def build_footer_actions_block(
    org: str,
    project_id: int,
    env_label: Optional[str],
    win: Dict[str, str],
) -> Dict[str, Any]:
    """
    Slack 하단 버튼 2개:
    - 📊 대시보드
    - 🔍 해당 기간 이슈 보기 (level:error,fatal + environment + start/end)
    """
    start_iso = win.get("start", "")
    end_iso   = win.get("end", "")
    urls = build_sentry_action_urls(org, project_id, env_label, start_iso, end_iso)

    return {
        "type": "actions",
        "elements": [
            {
                "type": "button",
                "text": {"type": "plain_text", "text": "📊 대시보드"},
                "url": urls["dashboard_url"],
            },
            {
                "type": "button",
                "text": {"type": "plain_text", "text": "🔍 해당 기간 이슈 보기"},
                "url": urls["issues_filtered_url"],
            },
        ],
    }

def post_to_slack(webhook_url: str, blocks: List[Dict[str, Any]]) -> None:
    payload = {"blocks": blocks}
    r = requests.post(webhook_url, headers={"Content-Type":"application/json"}, data=json.dumps(payload), timeout=30)
    try:
        r.raise_for_status()
        wlog("[13/13] Slack 전송 완료.")
    except requests.HTTPError as e:
        print(f"[Slack] Post failed {r.status_code}: {r.text[:300]}")
        raise

# =========== 메인 ===========
def main():
    step_total = 13
    wlog(f"[1/{step_total}] 환경 로드…")
    load_dotenv()
    token = os.getenv("SENTRY_AUTH_TOKEN") or ""
    org = os.getenv("SENTRY_ORG_SLUG") or ""
    project_slug = os.getenv("SENTRY_PROJECT_SLUG")
    project_id_env = os.getenv("SENTRY_PROJECT_ID")
    environment = os.getenv("SENTRY_ENVIRONMENT")
    slack_webhook = os.getenv("SLACK_WEBHOOK_URL")

    if not token or not org:
        raise SystemExit("SENTRY_AUTH_TOKEN, SENTRY_ORG_SLUG 필수")

    now_kst = datetime.now(KST)
    wlog(f"[2/{step_total}] 주간 범위 계산…")
    this_start_kst, this_end_kst = kst_week_bounds_for_last_week(now_kst)
    prev_start_kst, prev_end_kst = kst_week_bounds_for_prev_prev_week(now_kst)

    this_start_iso = to_utc_iso(this_start_kst)
    this_end_iso   = to_utc_iso(this_end_kst)
    prev_start_iso = to_utc_iso(prev_start_kst)
    prev_end_iso   = to_utc_iso(prev_end_kst)

    this_range_label = pretty_kst_range(this_start_kst, this_end_kst)
    prev_range_label = pretty_kst_range(prev_start_kst, prev_end_kst)
    wlog(f"  - 지난주: {this_range_label}")
    wlog(f"  - 지지난주: {prev_range_label}")

    wlog(f"[3/{step_total}] 프로젝트 ID 확인…")
    project_id = resolve_project_id(token, org, project_slug, project_id_env)

    # 주간 합계
    this_sum = discover_aggregates(token, org, project_id, environment, this_start_iso, this_end_iso)
    prev_sum = discover_aggregates(token, org, project_id, environment, prev_start_iso, prev_end_iso)

    # Crash Free 주간 평균
    cf_s, cf_u = sessions_crash_free_weekly_avg(token, org, project_id, environment, this_start_iso, this_end_iso)

    # 상위 이슈 (이벤트 기준)
    wlog(f"[6/{step_total}] 상위 이슈(이벤트 Top5) 수집…")
    top_events_this = discover_issue_table(token, org, project_id, environment, this_start_iso, this_end_iso, "-count()", 50)
    top_events_prev = discover_issue_table(token, org, project_id, environment, prev_start_iso, prev_end_iso, "-count()", 50)
    wlog(f"  - 이번 주 Top 후보 {len(top_events_this)}개 / 전주 {len(top_events_prev)}개")

    # 신규 이슈
    new_items = new_issues_in_week(token, org, project_id, environment, this_start_iso, this_end_iso)

    # 급증 이슈(주간)
    surge_items = detect_weekly_surge(token, org, project_id, environment, this_start_iso, this_end_iso, prev_start_iso, prev_end_iso)

    # 최신 릴리즈에서 해소된 이슈(사라진/많이 감소)
    rfix = release_fixes_in_week(token, org, project_id, environment, this_start_iso, this_end_iso)

    payload = {
        "this_week_range_kst": this_range_label,
        "prev_week_range_kst": prev_range_label,
        "this_week": {
            "events": this_sum["events"],
            "issues": this_sum["issues"],
            "users":  this_sum["users"],
            "crash_free_sessions": cf_s,
            "crash_free_users":    cf_u,
        },
        "prev_week": prev_sum,
        "top5_events": top_events_this[:WEEKLY_TOP_LIMIT],
        "prev_top_events": top_events_prev[:WEEKLY_TOP_LIMIT],
        "new_issues": new_items,
        "surge_issues": surge_items,
        "this_week_release_fixes": rfix,
    }

    wlog(f"[12/{step_total}] 결과 JSON 미리보기:")
    print(json.dumps(payload, ensure_ascii=False, indent=2))

    if slack_webhook:
        title = f"Sentry 주간 리포트 — {this_range_label}"
        blocks = build_weekly_blocks(
            payload,
            title,
            environment,
            org,
            int(project_id),
            {"start": this_start_iso, "end": this_end_iso},
        )
        wlog(f"[13/{step_total}] Slack 전송…")
        post_to_slack(slack_webhook, blocks)
    else:
        wlog(f"[13/{step_total}] SLACK_WEBHOOK_URL 미설정: Slack 전송 생략.")

if __name__ == "__main__":
    main()