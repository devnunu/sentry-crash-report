#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sentry 일일 요약(어제/그저께, 한국시간 기준) - REST API + Slack 포매팅/전송
- 어제 상위 5개 이슈, 신규 발생 이슈(firstSeen 당일), 고급 급증 이슈(DoD/7일 베이스라인)
- Slack Webhook으로 리포트 전송 (SLACK_WEBHOOK_URL이 있을 때)
"""

import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import math
import requests
from dotenv import load_dotenv

API_BASE = "https://sentry.io/api/0"

# ====== (상수) 급증 탐지 파라미터 ======
SURGE_MIN_COUNT = 30               # 서지 판정 최소 당일 이벤트 수
SURGE_GROWTH_MULTIPLIER = 2.0      # DoD 성장배율 임계치 (예: 2배↑)
SURGE_Z_THRESHOLD = 2.0            # Z-score 임계치
SURGE_MAD_THRESHOLD = 3.5          # Robust(MAD) 임계치
SURGE_MIN_NEW_BURST = 15           # 7일 모두 0일 때 당일 폭발로 간주하는 최소치
BASELINE_DAYS = 7                  # 베이스라인 일수(그저께 포함)
CANDIDATE_LIMIT = 100              # Discover per_page(최대 100). 페이지네이션으로 더 가져옴
SURGE_MAX_RESULTS = 50             # 결과 배열 상한
SURGE_ABSOLUTE_MIN = SURGE_MIN_COUNT

# =========================
# Slack 포맷 상수 (한국어)
# =========================
SLACK_MAX_NEW = 5
SLACK_MAX_SURGE = 10
TITLE_MAX = 90
EMOJI_TOP = "🏅"
EMOJI_NEW = "🆕"
EMOJI_SURGE = "📈"

# ----- 타임존 -----
try:
    from zoneinfo import ZoneInfo  # py3.9+
except Exception:
    from backports.zoneinfo import ZoneInfo  # type: ignore

KST = ZoneInfo("Asia/Seoul")
UTC = timezone.utc

# ----- 로그 유틸 -----
def log(msg: str) -> None:
    print(f"[Daily] {msg}")

# ----- 공통 유틸 -----
def kst_day_bounds_utc_iso(day_kst_date: datetime) -> Tuple[str, str]:
    start_kst = day_kst_date.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=KST)
    end_kst = start_kst + timedelta(days=1)
    start_utc = start_kst.astimezone(UTC)
    end_utc = end_kst.astimezone(UTC)
    return start_utc.isoformat().replace("+00:00", "Z"), end_utc.isoformat().replace("+00:00", "Z")


def pretty_kst_date(d: datetime) -> str:
    return d.astimezone(KST).strftime("%Y-%m-%d")


def auth_headers(token: str) -> Dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def ensure_ok(r: requests.Response) -> requests.Response:
    try:
        r.raise_for_status()
    except requests.HTTPError as e:
        msg = f"HTTP {r.status_code} for {r.request.method} {r.url}\nResponse: {r.text[:800]}"
        raise SystemExit(msg) from e
    return r


# ----- 프로젝트 ID -----
def resolve_project_id(token: str, org: str, project_slug: Optional[str], project_id_env: Optional[str]) -> int:
    if project_id_env:
        return int(project_id_env)
    if not project_slug:
        raise SystemExit("SENTRY_PROJECT_SLUG 또는 SENTRY_PROJECT_ID 중 하나는 필요합니다.")
    url = f"{API_BASE}/organizations/{org}/projects/"
    r = ensure_ok(requests.get(url, headers=auth_headers(token), timeout=30))
    for p in r.json():
        if p.get("slug") == project_slug:
            return int(p.get("id"))
    raise SystemExit(f"'{project_slug}' 프로젝트를 찾을 수 없습니다.")


# ----- Discover 집계 (전체 요약) -----
def discover_aggregates_for_day(
    token: str, org: str, project_id: int, environment: Optional[str],
    start_iso_utc: str, end_iso_utc: str
) -> Dict[str, Any]:
    url = f"{API_BASE}/organizations/{org}/events/"
    query = "level:[error,fatal]" + (f" environment:{environment}" if environment else "")
    params = {
        "field": ["count()", "count_unique(issue)", "count_unique(user)"],
        "project": project_id,
        "start": start_iso_utc,
        "end": end_iso_utc,
        "query": query,
        "referrer": "api.summaries.daily",
    }
    r = ensure_ok(requests.get(url, headers=auth_headers(token), params=params, timeout=60))
    rows = (r.json().get("data") or [])
    if not rows:
        return {"crash_events": 0, "unique_issues": 0, "impacted_users": 0}
    row0 = rows[0]
    return {
        "crash_events": int(row0.get("count()") or 0),
        "unique_issues": int(row0.get("count_unique(issue)") or 0),
        "impacted_users": int(row0.get("count_unique(user)") or 0),
    }


# ----- Discover: 이슈별 count() 맵 (페이지네이션) -----
def parse_link_cursor(link_header: str) -> Optional[str]:
    if 'rel="next"' in link_header and 'results="true"' in link_header:
        try:
            start = link_header.index("cursor=") + len("cursor=")
            end = link_header.index(">", start)
            return link_header[start:end]
        except Exception:
            return None
    return None


def issue_counts_map_for_day(
    token: str, org: str, project_id: int, environment: Optional[str],
    start_iso_utc: str, end_iso_utc: str, per_page: int = 100, max_pages: int = 10
) -> Dict[str, Dict[str, Any]]:
    """
    지정 일자의 이슈별 count()를 페이지네이션으로 최대 max_pages까지 수집
    반환: { issue_id: {"count": int, "title": str} }
    """
    url = f"{API_BASE}/organizations/{org}/events/"
    query = "level:[error,fatal]" + (f" environment:{environment}" if environment else "")
    headers = auth_headers(token)

    out: Dict[str, Dict[str, Any]] = {}
    cursor = None
    page = 0
    while True:
        page += 1
        params = {
            "field": ["issue", "title", "count()"],
            "project": project_id,
            "start": start_iso_utc,
            "end": end_iso_utc,
            "query": query,
            "orderby": "-count()",
            "per_page": per_page,  # 1~100
            "referrer": "api.summaries.issue-counts",
        }
        if cursor:
            params["cursor"] = cursor
        r = ensure_ok(requests.get(url, headers=headers, params=params, timeout=60))
        rows = (r.json().get("data") or [])
        for row in rows:
            iid = row.get("issue")
            if not iid:
                continue
            out[str(iid)] = {
                "count": int(row.get("count()") or 0),
                "title": row.get("title"),
            }
        link = r.headers.get("link", "")
        cursor = parse_link_cursor(link)
        if not cursor or page >= max_pages:
            break
    return out


# ----- 상위 5개 이슈 -----
def top_issues_for_day(
    token: str, org: str, project_id: int, environment: Optional[str],
    start_iso_utc: str, end_iso_utc: str, limit: int = 5
) -> List[Dict[str, Any]]:
    url = f"{API_BASE}/organizations/{org}/events/"
    query = "level:[error,fatal]" + (f" environment:{environment}" if environment else "")
    params = {
        "field": ["issue", "title", "count()"],
        "project": project_id,
        "start": start_iso_utc,
        "end": end_iso_utc,
        "query": query,
        "orderby": "-count()",
        "per_page": limit,
        "referrer": "api.summaries.top-issues",
    }
    r = ensure_ok(requests.get(url, headers=auth_headers(token), params=params, timeout=60))
    rows = (r.json().get("data") or [])
    return [
        {
            "issue_id": row.get("issue"),
            "title": row.get("title"),
            "event_count": row.get("count()"),
            "link": f"https://sentry.io/organizations/{org}/issues/{row.get('issue')}/" if row.get("issue") else None,
        }
        for row in rows[:limit]
    ]


# ----- 신규 발생 이슈 (Issues API: firstSeen) -----
def new_issues_for_day(
    token: str, org: str, project_id: int, environment: Optional[str],
    start_iso_utc: str, end_iso_utc: str
) -> List[Dict[str, Any]]:
    url = f"{API_BASE}/organizations/{org}/issues/"
    q_parts = [f"firstSeen:>={start_iso_utc}", f"firstSeen:<{end_iso_utc}", "level:[error,fatal]"]
    if environment:
        q_parts.append(f"environment:{environment}")
    query = " ".join(q_parts)
    params = {
        "project": project_id,
        "since": start_iso_utc,
        "until": end_iso_utc,
        "query": query,
        "sort": "date",
        "per_page": 100,
        "referrer": "api.summaries.new-issues",
    }
    headers = auth_headers(token)
    results: List[Dict[str, Any]] = []
    cursor: Optional[str] = None

    while True:
        if cursor:
            params["cursor"] = cursor
        r = ensure_ok(requests.get(url, headers=headers, params=params, timeout=60))
        items = r.json() or []
        for it in items:
            iid = it.get("id")
            permalink = it.get("permalink") or (f"https://sentry.io/organizations/{org}/issues/{iid}/" if iid else None)
            results.append({
                "issue_id": iid,
                "title": it.get("title"),
                "event_count": int(it.get("count")) if it.get("count") is not None else None,
                "first_seen": it.get("firstSeen"),
                "link": permalink,
            })
        link = r.headers.get("link", "")
        cursor = parse_link_cursor(link)
        if not cursor:
            break

    return results


# ====== 통계 유틸 ======
def mean_std(values: List[int]) -> Tuple[float, float]:
    if not values:
        return 0.0, 0.0
    m = sum(values) / len(values)
    var = sum((v - m) ** 2 for v in values) / max(len(values), 1)
    return m, math.sqrt(var)


def median(values: List[int]) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    n = len(s)
    mid = n // 2
    if n % 2 == 1:
        return float(s[mid])
    return (s[mid - 1] + s[mid]) / 2.0


def mad(values: List[int], med: Optional[float] = None) -> float:
    if not values:
        return 0.0
    m = med if med is not None else median(values)
    dev = [abs(v - m) for v in values]
    return median(dev)


# ====== 고급 급증 탐지 ======
def detect_surge_issues_advanced(
    token: str, org: str, project_id: int, environment: Optional[str],
    target_start_utc: str, target_end_utc: str,
    baseline_days: int = BASELINE_DAYS,
    per_page: int = 100, max_pages: int = 10
) -> List[Dict[str, Any]]:
    # 타겟일 이슈별 카운트(페이지네이션)
    today_map = issue_counts_map_for_day(
        token, org, project_id, environment,
        target_start_utc, target_end_utc, per_page, max_pages
    )

    # 직전 N일 맵들
    def iso_to_dt(iso_str: str) -> datetime:
        return datetime.fromisoformat(iso_str.replace("Z", "+00:00")).astimezone(UTC)
    t_start_dt = iso_to_dt(target_start_utc)

    prev_maps: List[Dict[str, Dict[str, Any]]] = []
    for i in range(1, baseline_days + 1):
        day_start_dt = t_start_dt - timedelta(days=i)
        day_end_dt = day_start_dt + timedelta(days=1)
        start_iso = day_start_dt.isoformat().replace("+00:00", "Z")
        end_iso   = day_end_dt.isoformat().replace("+00:00", "Z")
        prev_maps.append(
            issue_counts_map_for_day(token, org, project_id, environment, start_iso, end_iso, per_page, max_pages)
        )

    results: List[Dict[str, Any]] = []
    eps = 1e-9

    for iid, cur_info in today_map.items():
        # 방어: 타입 섞임 대비
        try:
            cur = int(cur_info.get("count") or 0)
        except Exception:
            cur = 0

        # 1차 필터: 절대 최소 건수(어떤 조건이든 이 값 미만이면 제외)
        if cur < SURGE_ABSOLUTE_MIN:
            continue

        title = cur_info.get("title")
        link  = f"https://sentry.io/organizations/{org}/issues/{iid}/"

        # D-1 및 베이스라인
        dby = int(prev_maps[0].get(iid, {}).get("count") or 0) if prev_maps else 0
        baseline_counts = [int(pm.get(iid, {}).get("count") or 0) for pm in prev_maps]

        mean_val, std_val = mean_std(baseline_counts)
        med_val           = median(baseline_counts)
        mad_val           = mad(baseline_counts, med_val)

        z = (cur - mean_val) / (std_val + eps) if std_val > 0 else (float("inf") if cur > mean_val else 0.0)
        mad_score = (cur - med_val) / (1.4826 * mad_val + eps) if mad_val > 0 else (float("inf") if cur > med_val else 0.0)
        growth = cur / max(dby, 1)

        is_all_zero = all(v == 0 for v in baseline_counts)
        conditions = {
            "growth":   growth >= SURGE_GROWTH_MULTIPLIER,
            "zscore":   z >= SURGE_Z_THRESHOLD,
            "madscore": mad_score >= SURGE_MAD_THRESHOLD,
            # 완전 신규 폭발: 그래도 cur는 위의 SURGE_ABSOLUTE_MIN을 이미 통과해야 함
            "new_burst": (is_all_zero and cur >= max(SURGE_MIN_NEW_BURST, SURGE_ABSOLUTE_MIN)),
        }

        if any(conditions.values()):
            results.append({
                "issue_id": iid,
                "title": title,
                "event_count": cur,
                "link": link,
                "dby_count": dby,
                "growth_multiplier": round(growth, 2),
                "zscore": None if math.isinf(z) else round(z, 2),
                "mad_score": None if math.isinf(mad_score) else round(mad_score, 2),
                "baseline_mean": round(mean_val, 2),
                "baseline_std": round(std_val, 2),
                "baseline_median": round(med_val, 2),
                "baseline_mad": round(mad_val, 2),
                "baseline_counts": baseline_counts,
                "reasons": [k for k, v in conditions.items() if v],
            })

    # 2차 보정: 혹시라도 계산/타입 이슈로 통과한 항목을 다시 절대 최소건수로 걸러냄
    results = [r for r in results if int(r.get("event_count") or 0) >= SURGE_ABSOLUTE_MIN]

    # 정렬/상한
    results.sort(
        key=lambda x: (x["event_count"], (x["zscore"] or 0), (x["mad_score"] or 0), x["growth_multiplier"]),
        reverse=True
    )
    return results[:SURGE_MAX_RESULTS]


# ----- Crash Free 메트릭 -----
def sessions_crash_free_for_day(
    token: str, org: str, project_id: int, environment: Optional[str],
    start_iso_utc: str, end_iso_utc: str
) -> Tuple[Optional[float], Optional[float]]:
    url = f"{API_BASE}/organizations/{org}/sessions/"
    params = {
        "project": project_id,
        "start": start_iso_utc,
        "end": end_iso_utc,
        "interval": "1d",
        "field": ["crash_free_rate(session)", "crash_free_rate(user)"],
        "referrer": "api.summaries.daily",
    }
    if environment:
        params["environment"] = environment
    r = ensure_ok(requests.get(url, headers=auth_headers(token), params=params, timeout=60))
    data = r.json()
    cf_s, cf_u = None, None
    for g in data.get("groups", []):
        series = g.get("series", {})
        if "crash_free_rate(session)" in series and series["crash_free_rate(session)"]:
            cf_s = float(series["crash_free_rate(session)"][-1])
        if "crash_free_rate(user)" in series and series["crash_free_rate(user)"]:
            cf_u = float(series["crash_free_rate(user)"][-1])
    return cf_s, cf_u


# =========================
# AI 조언 생성 (OpenAI)
# =========================
from openai import OpenAI
import re

def generate_ai_advice(summary_payload: Dict[str, Any], y_key: str, dby_key: Optional[str], environment: Optional[str]) -> Dict[str, Any]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return {"fallback_text": "AI 조언을 생성하려면 OPENAI_API_KEY가 필요합니다."}

    client = OpenAI(api_key=api_key)

    # 어제 상위 5 이슈(간단 버전)를 별도로 제공 → per_issue_notes 매칭 정확도 ↑
    top5 = (summary_payload.get(y_key, {}) or {}).get("top_5_issues", []) or []
    top5_compact = [
        {"issue_id": t.get("issue_id"), "title": t.get("title"), "event_count": t.get("event_count")}
        for t in top5
    ]

    # ✅ 맥락/정의 설명 + 요약 데이터(JSON) 그대로 전달 (간단하지만 충분한 컨텍스트)
    prompt = (
        "당신은 Sentry 오류 리포트를 분석하는 친근한 AI 코치입니다. "
        "친근하고 자연스러운 말투로, 개발자에게 도움이 될 인사이트를 주세요. "
        "데이터를 그냥 나열하지 말고 의미 있는 포인트만 뽑아주세요. 인사이트가 없다면 간단히 넘어가도 됩니다. "
        "마지막엔 오늘 상황을 한두 문장으로 친근하게 요약(가벼운 농담/격려 허용, 중요한 경고는 분명히)하세요.\n\n"
        "=== 분석 맥락 ===\n"
        f"- 이 리포트는 '어제({y_key})' 기준 Summary 데이터입니다. 비교 대상은 '그저께({dby_key or 'N/A'})'입니다.\n"
        "- 이벤트(crash_events): level이 fatal, error인 이벤트 발생 건수입니다.\n"
        "- 이슈(unique_issues): 위 이벤트가 속한 고유 이슈 개수입니다.\n"
        "- 영향 사용자(impacted_users): 해당 이슈로 영향을 받은 사용자 수입니다.\n"
        "- Crash Free: 'crash_free_rate(session/user)'로, 높은 값일수록 안정적입니다.\n\n"
        "=== 출력 형식 ===\n"
        "반드시 **순수 JSON만** 출력하세요. 코드블록(````json`)로 감싸지 마세요.\n"
        "{\n"
        "  \"newsletter_summary\": \"\",   \n"
        "  \"today_actions\": [ {\"title\":\"\", \"why\":\"\", \"owner_role\":\"\", \"suggestion\":\"\"} ],\n"
        "  \"root_cause\": [],\n"
        "  \"per_issue_notes\": [ {\"issue_title\":\"\", \"note\":\"\"} ]\n"
        "}\n\n"
        "=== per_issue_notes 작성 규칙 ===\n"
        "- 아래 상위 5개 이슈 중 **의미 있는 항목만** 코멘트를 남기세요(불필요하면 생략 가능).\n"
        "- `issue_title`은 반드시 아래 title 문자열을 그대로 사용하세요(변형 금지).\n\n"
        f"[상위 5개 이슈 (요약)]\n{json.dumps(top5_compact, ensure_ascii=False)}\n\n"
        "=== 전체 Summary JSON ===\n"
        f"{json.dumps(summary_payload, ensure_ascii=False)}\n"
    )

    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            temperature=0.7,
            max_tokens=900,
            messages=[{"role": "user", "content": prompt}],
        )
        text = resp.choices[0].message.content.strip()

        # 모델이 혹시 코드블록으로 감싸면 JSON만 추출
        if text.startswith("```"):
            m = re.search(r"\{.*\}", text, re.DOTALL)
            if m:
                text = m.group(0)

        data = json.loads(text)

        # 기본 키/타입 보정
        data.setdefault("newsletter_summary", "")
        data.setdefault("today_actions", [])
        data.setdefault("root_cause", [])
        data.setdefault("per_issue_notes", [])

        if not isinstance(data["newsletter_summary"], str):
            data["newsletter_summary"] = str(data["newsletter_summary"])
        for k in ["today_actions", "root_cause", "per_issue_notes"]:
            if not isinstance(data[k], list):
                data[k] = []

        # 액션 항목 정규화
        norm_actions = []
        for x in data["today_actions"]:
            if isinstance(x, dict):
                a = {
                    "title": (x.get("title") or "").strip(),
                    "why": (x.get("why") or "").strip(),
                    "owner_role": (x.get("owner_role") or "").strip(),
                    "suggestion": (x.get("suggestion") or "").strip(),
                }
                if any(a.values()):
                    norm_actions.append(a)
        data["today_actions"] = norm_actions

        # per_issue_notes 문자열 정규화
        data["per_issue_notes"] = [
            {"issue_title": str(i.get("issue_title", "")).strip(), "note": str(i.get("note", "")).strip()}
            for i in data["per_issue_notes"] if isinstance(i, dict)
        ]

        # (옵션) 최소 폴백: per_issue_notes가 비었고 root_cause가 있으면 top1에 한 줄 붙여줌
        if not data["per_issue_notes"]:
            root_causes = data.get("root_cause") or []
            if top5 and root_causes:
                data["per_issue_notes"] = [{
                    "issue_title": top5[0].get("title") or "(제목 없음)",
                    "note": str(root_causes[0]).strip()
                }]

        return data

    except Exception as e:
        snippet = text[:200] if 'text' in locals() and text else "(no text)"
        return {"fallback_text": f"AI 조언 생성 실패: {e.__class__.__name__}: {str(e)} | snippet={snippet}"}


# ====== Slack 메시지 빌더/전송 ======
# ---------- 도우미 ----------
def truncate(s: Optional[str], n: int) -> Optional[str]:
    if s is None:
        return None
    return s if len(s) <= n else s[: n - 1] + "…"

def fmt_pct(v: Optional[float]) -> str:
    if v is None:
        return "N/A"
    pct = v * 100
    truncated = int(pct * 100) / 100  # 소수점 둘째 자리 절삭
    return f"{truncated:.2f}%"

def parse_iso_to_kst_label(start_utc_iso: str, end_utc_iso: str) -> str:
    """UTC ISO 구간을 한국시(KST)로 바꿔 사람이 읽기 좋게 표기"""
    def to_kst(iso_s: str) -> datetime:
        return datetime.fromisoformat(iso_s.replace("Z", "+00:00")).astimezone(KST)
    s = to_kst(start_utc_iso)
    e = to_kst(end_utc_iso)
    # 예: 2025-09-01 00:00 ~ 2025-09-01 23:59 (KST)
    s_txt = s.strftime("%Y-%m-%d %H:%M")
    e_txt = e.strftime("%Y-%m-%d %H:%M")
    return f"{s_txt} ~ {e_txt} (KST)"

def diff_str(cur: int, prev: int, suffix: str = "건") -> str:
    delta = cur - prev
    if delta > 0:
        arrow = "🔺"
    elif delta < 0:
        arrow = "🔻"
    else:
        arrow = "—"
    ratio = ""
    if prev > 0:
        ratio = f" ({(delta/prev)*100:+.1f}%)"
    return f"{cur}{suffix} {arrow}{abs(delta)}{suffix}{ratio}"

# ---------- 이슈 라인(한국어) ----------
def issue_line_kr(item: Dict[str, Any]) -> str:
    """제목에만 링크, 이슈키(#... ) 제거, 개수는 '7건'으로 표기"""
    title = truncate(item.get("title"), TITLE_MAX) or "(제목 없음)"
    link = item.get("link")
    count = item.get("event_count")
    count_txt = f"{int(count)}건" if isinstance(count, (int, float)) and count is not None else "–"
    title_link = f"<{link}|{title}>" if link else title
    return f"• {title_link} · {count_txt}"

# ---------- 급증 이슈 설명(서술형) ----------
def surge_explanation_kr(item: Dict[str, Any]) -> str:
    """
    예시:
    • Login NPE · 42건
      ↳ 전일 0건 → 어제 42건으로 급증. 최근 7일 평균 5.3건/중앙값 4건 대비 크게 증가.
      ↳ 판정 근거: growth/madscore
    """
    base = issue_line_kr(item)
    cur = item.get("event_count") or 0
    d1 = item.get("dby_count") or 0
    mean_v = item.get("baseline_mean")
    med_v = item.get("baseline_median")
    reasons = item.get("reasons", [])
    # 서술: 전일 대비, 7일 평균/중앙값 대비
    parts = []
    parts.append(f"전일 {d1}건 → 어제 {cur}건으로 급증.")
    if isinstance(mean_v, (int, float)) and isinstance(med_v, (int, float)):
        parts.append(f"최근 7일 평균 {mean_v:.1f}건/중앙값 {med_v:.0f}건 대비 크게 증가.")
    # 규칙명만 간단 표기
    if reasons:
        ko = {
            "growth": "전일 대비 급증",
            "zscore": "평균 대비 통계적 급증",
            "madscore": "중앙값 대비 이상치",
            "new_burst": "최근 기록 거의 없음에서 폭증",
        }
        pretty = [ko.get(r, r) for r in reasons]
        parts.append("판정 근거: " + "/".join(pretty))
    detail = "  ↳ " + " ".join(parts)
    return f"{base}\n{detail}"

# ---------- 한국어 블록 빌더 ----------
def build_ai_advice_blocks(ai: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    AI 결과 dict → Slack Blocks
    - 타이틀: ":brain: AI 분석 코멘트"
    - 내용: 뉴스레터 요약(필수) + 오늘의 액션(옵션)
    - 원인 추정·점검 / 이슈별 코멘트는 top5 섹션에 병합되므로 여기서는 출력하지 않음
    """
    blocks: List[Dict[str, Any]] = []
    blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": "*:brain: AI 분석 코멘트*"}})

    if "fallback_text" in ai:
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": ai["fallback_text"]}})
        blocks.append({"type": "divider"})
        return blocks

    summary_text = (ai.get("newsletter_summary") or "").strip()
    if summary_text:
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": f"> {summary_text}"}})

    actions = ai.get("today_actions", []) or []
    if actions:
        lines = []
        for x in actions:
            t = x.get("title", "").strip() or "(제목 없음)"
            s = x.get("suggestion", "").strip()
            extra = []
            if x.get("owner_role"): extra.append(f"담당: {x['owner_role']}")
            if x.get("why"):        extra.append(f"이유: {x['why']}")
            suffix = f" _({', '.join(extra)})_" if extra else ""
            lines.append(f"• *{t}* — {s}{suffix}")
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": "*오늘의 액션*\n" + "\n".join(lines)}})

    blocks.append({"type": "divider"})
    return blocks

def build_slack_blocks_for_day(
    date_label: str,
    env_label: Optional[str],
    day_obj: Dict[str, Any],
    prev_day_obj: Optional[Dict[str, Any]] = None,
    ai_blocks: Optional[List[Dict[str, Any]]] = None,
    ai_data: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    # 현재값
    cf_s = day_obj.get("crash_free_sessions_pct")
    cf_u = day_obj.get("crash_free_users_pct")
    events = int(day_obj.get("crash_events", 0))
    issues = int(day_obj.get("unique_issues", 0))
    users  = int(day_obj.get("impacted_users", 0))

    # 전일값 (증감은 이벤트/이슈/사용자에만 적용)
    prev_events = prev_issues = prev_users = 0
    if prev_day_obj:
        prev_events = int(prev_day_obj.get("crash_events", 0))
        prev_issues = int(prev_day_obj.get("unique_issues", 0))
        prev_users  = int(prev_day_obj.get("impacted_users", 0))

    # Summary: 요청하신 순서로 표기 (이벤트/이슈/사용자 → Crash Free)
    summary_lines = [
        "*:memo: Summary*",
        f"• 💥 *이벤트*: {diff_str(events, prev_events, suffix='건') if prev_day_obj else f'{events}건'}",
        f"• 🐞 *이슈*: {diff_str(issues, prev_issues, suffix='건') if prev_day_obj else f'{issues}건'}",
        f"• 👥 *영향 사용자*: {diff_str(users, prev_users, suffix='명') if prev_day_obj else f'{users}명'}",
        f"• 🛡️ *Crash Free 세션*: {fmt_pct(cf_s)} / *Crash Free 사용자*: {fmt_pct(cf_u)}",
    ]
    kpi_text = "\n".join(summary_lines)

    # 집계 구간(KST)
    win = day_obj.get("window_utc") or {}
    kst_window = parse_iso_to_kst_label(win.get("start","?"), win.get("end","?"))

    # 헤더
    title = f"Sentry 일간 리포트 — {date_label}"
    if env_label:
        title += f"  ·  {env_label}"

    blocks: List[Dict[str, Any]] = [
        {"type": "header", "text": {"type": "plain_text", "text": title, "emoji": True}},
        {"type": "section", "text": {"type": "mrkdwn", "text": kpi_text}},
        {"type": "context", "elements": [{"type": "mrkdwn", "text": f"*집계 구간*: {kst_window}"}]},
        {"type": "divider"},
    ]

    # === 여기서 AI 섹션 삽입 ===
    if ai_blocks:
        blocks.extend(ai_blocks)

    # 아래는 기존 섹션: 타이틀은 이모지 + 굵게 유지
    top = day_obj.get("top_5_issues") or []
    if top:
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": "*:sports_medal: 상위 5개 이슈*"}})
        merged_lines = render_top5_with_ai(top, ai_data) if ai_data else "\n".join(issue_line_kr(x) for x in top)
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": merged_lines}})
        blocks.append({"type": "divider"})

    new_issues = (day_obj.get("new_issues") or [])[:SLACK_MAX_NEW]
    if new_issues:
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": "*:new: 신규 발생 이슈*"}})
        lines = "\n".join(issue_line_kr(x) for x in new_issues)
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": lines}})
        blocks.append({"type": "divider"})

    surge = [x for x in (day_obj.get("surge_issues") or []) if int(x.get("event_count") or 0) >= SURGE_ABSOLUTE_MIN]
    surge = surge[:SLACK_MAX_SURGE]
    if surge:
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": "*:chart_with_upwards_trend: 급증(서지) 이슈*"}})
        lines = "\n".join(surge_explanation_kr(x) for x in surge)
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": lines}})
        blocks.append({"type": "divider"})

    return blocks

def _norm_title(s: str) -> str:
    return " ".join((s or "").lower().strip().replace("…", "").split())

def render_top5_with_ai(top5: List[Dict[str, Any]], ai: Dict[str, Any]) -> str:
    """
    상위 5개 이슈 라인에 AI의 per_issue_notes를 들여쓴 불릿으로 결합.
    우선순위: issue_id 매칭 > 제목 정규화 매칭(startswith 포함)
    출력은 mrkdwn 문자열.
    """
    notes = ai.get("per_issue_notes") or []
    # 인덱스: issue_id → [notes], title_norm → [notes]
    by_id: Dict[str, List[Dict[str, Any]]] = {}
    by_tn: Dict[str, List[Dict[str, Any]]] = {}
    for n in notes:
        if not isinstance(n, dict): continue
        iid = str(n.get("issue_id") or "").strip()
        ititle = n.get("issue_title") or ""
        tn = _norm_title(ititle)
        by_id.setdefault(iid, []).append(n) if iid else None
        if tn:
            by_tn.setdefault(tn, []).append(n)

    lines: List[str] = []
    for it in top5:
        title = truncate(it.get("title"), TITLE_MAX) or "(제목 없음)"
        link  = it.get("link")
        cnt   = it.get("event_count")
        cnt_t = f"{int(cnt)}건" if isinstance(cnt, (int, float)) and cnt is not None else "–"
        head  = f"• <{link}|{title}> · {cnt_t}" if link else f"• {title} · {cnt_t}"
        lines.append(head)

        # 매칭 노트 수집
        matched: List[Dict[str, Any]] = []
        iid = str(it.get("issue_id") or "").strip()
        if iid and iid in by_id:
            matched.extend(by_id[iid])
        else:
            tn = _norm_title(title)
            # exact 우선, 없으면 startswith 유사 매칭
            if tn in by_tn:
                matched.extend(by_tn[tn])
            else:
                # 느슨한 startswith
                for k, v in by_tn.items():
                    if tn.startswith(k) or k.startswith(tn):
                        matched.extend(v)
                        break

        # 들여쓴 불릿(있을 때만)
        for n in matched:
            note = (n.get("note") or "").strip()
            cause = (n.get("why") or n.get("root_cause") or "").strip()  # 혹시 why/root_cause 필드가 온 경우 대비
            if cause:
                lines.append(f"  ◦ 원인/점검: {cause}")
            if note:
                lines.append(f"  ◦ 코멘트: {note}")

    return "\n".join(lines)

# ---------- Slack 전송 ----------
def post_to_slack(webhook_url: str, blocks: List[Dict[str, Any]]) -> None:
    payload = {"blocks": blocks}
    r = requests.post(webhook_url, headers={"Content-Type": "application/json"}, data=json.dumps(payload), timeout=30)
    try:
        r.raise_for_status()
    except requests.HTTPError as e:
        print(f"[Slack] Post failed {r.status_code}: {r.text[:300]}")
        raise


# ====== 메인 ======
def main():
    step_total = 14
    log(f"[1/{step_total}] 환경 변수 로드…")
    load_dotenv()
    token = os.getenv("SENTRY_AUTH_TOKEN") or ""
    org = os.getenv("SENTRY_ORG_SLUG") or ""
    project_slug = os.getenv("SENTRY_PROJECT_SLUG")
    project_id_env = os.getenv("SENTRY_PROJECT_ID")
    environment = os.getenv("SENTRY_ENVIRONMENT")
    slack_webhook = os.getenv("SLACK_WEBHOOK_URL")

    if not token or not org:
        raise SystemExit("SENTRY_AUTH_TOKEN, SENTRY_ORG_SLUG 필수")

    log(f"[2/{step_total}] 날짜 계산(KST 기준 어제/그저께)…")
    now_kst = datetime.now(KST)
    y_kst = (now_kst - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    dby_kst = (now_kst - timedelta(days=2)).replace(hour=0, minute=0, second=0, microsecond=0)
    y_start, y_end = kst_day_bounds_utc_iso(y_kst)
    dby_start, dby_end = kst_day_bounds_utc_iso(dby_kst)
    log(f"  - 어제(KST): {pretty_kst_date(y_kst)} / UTC: {y_start} ~ {y_end}")
    log(f"  - 그저께(KST): {pretty_kst_date(dby_kst)} / UTC: {dby_start} ~ {dby_end}")

    log(f"[3/{step_total}] 프로젝트 확인/해결(org={org}, slug={project_slug}, id_env={project_id_env})…")
    project_id = resolve_project_id(token, org, project_slug, project_id_env)
    log(f"  - project_id={project_id}")

    # --- 어제 데이터 ---
    log(f"[4/{step_total}] 어제 집계 수집(count/unique issue/user)…")
    y_summary = discover_aggregates_for_day(token, org, project_id, environment, y_start, y_end)
    log(f"  - events={y_summary.get('crash_events')} / issues={y_summary.get('unique_issues')} / users={y_summary.get('impacted_users')}")

    log(f"[5/{step_total}] 어제 Crash Free(session/user) 수집…")
    y_cf_s, y_cf_u = sessions_crash_free_for_day(token, org, project_id, environment, y_start, y_end)
    log(f"  - crash_free(session)={fmt_pct(y_cf_s)} / crash_free(user)={fmt_pct(y_cf_u)}")

    log(f"[6/{step_total}] 어제 상위 5개 이슈 수집…")
    y_top = top_issues_for_day(token, org, project_id, environment, y_start, y_end)
    log(f"  - top5 count={len(y_top)}")

    log(f"[7/{step_total}] 어제 신규 발생 이슈(firstSeen 당일) 수집…")
    y_new = new_issues_for_day(token, org, project_id, environment, y_start, y_end)
    log(f"  - new issues count={len(y_new)}")

    log(f"[8/{step_total}] 어제 급증(서지) 이슈 탐지(베이스라인 {BASELINE_DAYS}일)…")
    y_surge_adv = detect_surge_issues_advanced(token, org, project_id, environment, y_start, y_end)
    log(f"  - surge detected={len(y_surge_adv)} (min_count={SURGE_MIN_COUNT})")

    # --- 그저께 데이터 (비교용/출력 포함) ---
    log(f"[9/{step_total}] 그저께 집계 수집…")
    dby_summary = discover_aggregates_for_day(token, org, project_id, environment, dby_start, dby_end)
    log(f"  - events={dby_summary.get('crash_events')} / issues={dby_summary.get('unique_issues')} / users={dby_summary.get('impacted_users')}")

    log(f"[10/{step_total}] 그저께 Crash Free(session/user) 수집…")
    dby_cf_s, dby_cf_u = sessions_crash_free_for_day(token, org, project_id, environment, dby_start, dby_end)
    log(f"  - crash_free(session)={fmt_pct(dby_cf_s)} / crash_free(user)={fmt_pct(dby_cf_u)}")

    result = {
        "timezone": "Asia/Seoul (KST)",
        pretty_kst_date(y_kst): {
            **y_summary,
            "issues_count": y_summary["unique_issues"],
            "unique_issues_in_events": y_summary["unique_issues"],
            "crash_free_sessions_pct": y_cf_s,
            "crash_free_users_pct": y_cf_u,
            "top_5_issues": y_top,
            "new_issues": y_new,
            "surge_issues": y_surge_adv,
            "window_utc": {"start": y_start, "end": y_end},
        },
        pretty_kst_date(dby_kst): {
            **dby_summary,
            "issues_count": dby_summary["unique_issues"],
            "unique_issues_in_events": dby_summary["unique_issues"],
            "crash_free_sessions_pct": dby_cf_s,
            "crash_free_users_pct": dby_cf_u,
            "window_utc": {"start": dby_start, "end": dby_end},
        },
    }

    log(f"[11/{step_total}] 콘솔 출력(JSON)…")
    print(json.dumps(result, ensure_ascii=False, indent=2))

    if slack_webhook:
        y_key = pretty_kst_date(y_kst)
        dby_key = pretty_kst_date(dby_kst)

        log(f"[12/{step_total}] AI 코멘트 생성 시도(gpt-4o-mini)…")
        ai_data = generate_ai_advice(result, y_key=y_key, dby_key=dby_key, environment=environment)
        if "fallback_text" in ai_data:
            log(f"  - AI 생성 실패: {ai_data['fallback_text']}")
        else:
            log("  - AI 코멘트 생성 완료")
        ai_blocks = build_ai_advice_blocks(ai_data)

        log(f"[13/{step_total}] Slack Blocks 구축…")
        y_blocks = build_slack_blocks_for_day(
            date_label=y_key,
            env_label=environment,
            day_obj=result[y_key],
            prev_day_obj=result.get(dby_key),
            ai_blocks=ai_blocks,
            ai_data=ai_data,
        )

        log(f"[14/{step_total}] Slack 전송 시도…")
        try:
            post_to_slack(slack_webhook, y_blocks)
            log("  - 전송 완료 ✅")
        except Exception as e:
            log(f"  - 전송 실패 ❌: {e}")
    else:
        log("Slack Webhook 미설정 — 전송 스킵")

if __name__ == "__main__":
    main()