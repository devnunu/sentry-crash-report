#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sentry 일일 요약(어제/그저께, 한국시간 기준) - REST API 버전 (MCP 미사용)
필요 항목:
- 크래시 이벤트 수 (level in {fatal, error})
- 이슈 개수 (해당일 크래시 이벤트가 속한 유니크 이슈 수)
- 유니크 이슈 수 (동일)
- 영향을 받은 유저 수 (유니크 사용자)
- Crash Free Sessions %
- Crash Free Users %

.env 예시
SENTRY_AUTH_TOKEN=
SENTRY_ORG_SLUG=
SENTRY_PROJECT_SLUG=
SLACK_WEBHOOK_URL=

SENTRY_PROJECT_ID=
DASH_BOARD_ID=
SENTRY_ENVIRONMENT=

# 일관성 모드(페이징/정렬 등 보수적 옵션 적용 여부)
CONSISTENCY_MODE=
# 테스트 모드 (실제 호출 대신 샘플 출력)
TEST_MODE=false
"""

import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

import requests
from dotenv import load_dotenv

API_BASE = "https://sentry.io/api/0"

# ---------- 시간대 ----------
try:
    from zoneinfo import ZoneInfo  # py3.9+
except Exception:  # pragma: no cover
    from backports.zoneinfo import ZoneInfo  # type: ignore

KST = ZoneInfo("Asia/Seoul")
UTC = timezone.utc


# ---------- 유틸 ----------
def kst_day_bounds_utc_iso(day_kst_date: datetime) -> Tuple[str, str]:
    """
    KST 기준 특정 날짜(day_kst_date: tz-aware, KST) 하루의 시작/끝을 UTC ISO8601로 반환
    (start inclusive, end exclusive)
    """
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
        msg = f"HTTP {r.status_code} for {r.request.method} {r.url}\n" \
              f"Response: {r.text[:500]}"
        raise SystemExit(msg) from e
    return r


# ---------- 프로젝트 ID 해석 ----------
def resolve_project_id(
    token: str, org: str, project_slug: Optional[str], project_id_env: Optional[str]
) -> int:
    """
    - SENTRY_PROJECT_ID 값이 있으면 그걸 사용
    - 없으면 /organizations/{org}/projects/ 를 호출해 slug 매칭하여 id 획득
    """
    if project_id_env:
        try:
            return int(project_id_env)
        except ValueError as e:
            raise SystemExit("SENTRY_PROJECT_ID는 정수여야 합니다.") from e

    if not project_slug:
        raise SystemExit("SENTRY_PROJECT_SLUG 또는 SENTRY_PROJECT_ID 중 하나는 필요합니다.")

    url = f"{API_BASE}/organizations/{org}/projects/"
    r = ensure_ok(requests.get(url, headers=auth_headers(token), timeout=30))
    projects = r.json()
    for p in projects:
        if p.get("slug") == project_slug:
            pid = p.get("id")
            if pid is None:
                break
            return int(pid)
    raise SystemExit(f"프로젝트 슬러그 '{project_slug}'에 해당하는 ID를 찾지 못했습니다.")


# ---------- Discover(Events) 집계 ----------
def discover_aggregates_for_day(
    token: str,
    org: str,
    project_id: int,
    environment: Optional[str],
    start_iso_utc: str,
    end_iso_utc: str,
    consistency_mode: bool = False,
) -> Dict[str, Any]:
    """
    해당 일자 구간(UTC)에서 level in {fatal, error}인 이벤트만 대상으로:
      - count()                        → crash_events
      - count_unique(issue)           → unique_issues
      - count_unique(user)            → impacted_users
    Sentry Discover API: GET /organizations/{org}/events/
      params:
        field=count()&field=count_unique(issue)&field=count_unique(user)
        project=...&start=...&end=...&query=...
    """
    url = f"{API_BASE}/organizations/{org}/events/"
    # 쿼리 구성
    q_parts = ["level:[error,fatal]"]
    if environment:
        q_parts.append(f"environment:{environment}")
    query = " ".join(q_parts)

    params = {
        "field": ["count()", "count_unique(issue)", "count_unique(user)"],
        "project": project_id,
        "start": start_iso_utc,
        "end": end_iso_utc,
        "query": query,
        "referrer": "api.summaries.daily",  # 관행적으로 referrer를 넣는 게 좋음
    }
    if consistency_mode:
        # 보수적으로 page/per_page/interval 등을 명시하고 싶다면 여기에
        pass

    r = ensure_ok(requests.get(url, headers=auth_headers(token), params=params, timeout=60))
    data = r.json()

    # data는 {"data":[{"count()":123,"count_unique(issue)":13,"count_unique(user)":80}], ...} 형태가 일반적
    rows = data.get("data") or []
    if not rows:
        return {"crash_events": 0, "unique_issues": 0, "impacted_users": 0}

    row0 = rows[0]
    crash_events = int(row0.get("count()") or 0)
    unique_issues = int(row0.get("count_unique(issue)") or 0)
    impacted_users = int(row0.get("count_unique(user)") or 0)

    return {
        "crash_events": crash_events,
        "unique_issues": unique_issues,
        "impacted_users": impacted_users,
    }


# ---------- Sessions 메트릭 (Crash Free) ----------
def sessions_crash_free_for_day(
    token: str,
    org: str,
    project_id: int,
    environment: Optional[str],
    start_iso_utc: str,
    end_iso_utc: str,
) -> Tuple[Optional[float], Optional[float]]:
    """
    Crash Free Sessions %, Crash Free Users %를 Sessions API로 조회
    GET /organizations/{org}/sessions/
      - field=crash_free_rate(session)
      - field=crash_free_rate(user)
      - start, end, interval=1d, project, (environment)
    반환: (crash_free_sessions_pct, crash_free_users_pct) 0~100 단위 (소수)
    """
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

    # 응답 예시(요지): {"groups":[{"series":{"crash_free_rate(session)":[99.1]}, "by":{...}}, {"series":{"crash_free_rate(user)":[98.7]}}], ...}
    groups = data.get("groups") or []
    cf_session = None
    cf_user = None
    for g in groups:
        series = (g.get("series") or {})
        ses = series.get("crash_free_rate(session)")
        usr = series.get("crash_free_rate(user)")
        if isinstance(ses, list) and ses:
            cf_session = float(ses[-1])
        if isinstance(usr, list) and usr:
            cf_user = float(usr[-1])

    return cf_session, cf_user


# ---------- 메인 ----------
def main():
    load_dotenv()

    token = os.getenv("SENTRY_AUTH_TOKEN") or ""
    org = os.getenv("SENTRY_ORG_SLUG") or ""
    project_slug = os.getenv("SENTRY_PROJECT_SLUG") or None
    project_id_env = os.getenv("SENTRY_PROJECT_ID") or None
    environment = os.getenv("SENTRY_ENVIRONMENT") or None

    test_mode = (os.getenv("TEST_MODE") or "").lower() == "true"
    consistency_mode = (os.getenv("CONSISTENCY_MODE") or "").lower() == "true"

    if not token or not org:
        raise SystemExit("SENTRY_AUTH_TOKEN, SENTRY_ORG_SLUG 은 필수입니다.")

    # 오늘 기준 어제/그저께 (KST)
    now_kst = datetime.now(KST)
    y_kst = (now_kst - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    dby_kst = (now_kst - timedelta(days=2)).replace(hour=0, minute=0, second=0, microsecond=0)

    y_start_utc, y_end_utc = kst_day_bounds_utc_iso(y_kst)
    dby_start_utc, dby_end_utc = kst_day_bounds_utc_iso(dby_kst)

    if test_mode:
        result = {
            "timezone": "Asia/Seoul (KST)",
            pretty_kst_date(y_kst): {
                "crash_events": 120,
                "issues_count": 13,
                "unique_issues_in_events": 13,
                "impacted_users": 80,
                "crash_free_sessions_pct": 99.12,
                "crash_free_users_pct": 98.76,
                "window_utc": {"start": y_start_utc, "end": y_end_utc},
            },
            pretty_kst_date(dby_kst): {
                "crash_events": 95,
                "issues_count": 10,
                "unique_issues_in_events": 10,
                "impacted_users": 72,
                "crash_free_sessions_pct": 98.50,
                "crash_free_users_pct": 97.90,
                "window_utc": {"start": dby_start_utc, "end": dby_end_utc},
            },
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    # 프로젝트 ID 확보
    project_id = resolve_project_id(token, org, project_slug, project_id_env)

    # --- 어제 ---
    y_ev = discover_aggregates_for_day(
        token, org, project_id, environment, y_start_utc, y_end_utc, consistency_mode
    )
    y_cf_s, y_cf_u = sessions_crash_free_for_day(
        token, org, project_id, environment, y_start_utc, y_end_utc
    )

    # --- 그저께 ---
    dby_ev = discover_aggregates_for_day(
        token, org, project_id, environment, dby_start_utc, dby_end_utc, consistency_mode
    )
    dby_cf_s, dby_cf_u = sessions_crash_free_for_day(
        token, org, project_id, environment, dby_start_utc, dby_end_utc
    )

    result = {
        "timezone": "Asia/Seoul (KST)",
        pretty_kst_date(y_kst): {
            "crash_events": y_ev["crash_events"],
            "issues_count": y_ev["unique_issues"],             # 이벤트 기준 유니크 이슈 수
            "unique_issues_in_events": y_ev["unique_issues"],  # 동일 의미로 중복 표기
            "impacted_users": y_ev["impacted_users"],
            "crash_free_sessions_pct": y_cf_s,
            "crash_free_users_pct": y_cf_u,
            "window_utc": {"start": y_start_utc, "end": y_end_utc},
        },
        pretty_kst_date(dby_kst): {
            "crash_events": dby_ev["crash_events"],
            "issues_count": dby_ev["unique_issues"],
            "unique_issues_in_events": dby_ev["unique_issues"],
            "impacted_users": dby_ev["impacted_users"],
            "crash_free_sessions_pct": dby_cf_s,
            "crash_free_users_pct": dby_cf_u,
            "window_utc": {"start": dby_start_utc, "end": dby_end_utc},
        },
    }

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()