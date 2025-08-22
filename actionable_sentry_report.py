#!/usr/bin/env python3
import argparse
import datetime as dt
import json
import os
import re
from typing import Any, Dict, List, Optional, Tuple

import requests
from dotenv import load_dotenv

# ------ Optional OpenAI ------
try:
    from openai import OpenAI  # pip install openai
except Exception:
    OpenAI = None

# ==============================
# 환경 변수
# ==============================
load_dotenv()

SENTRY_API_BASE = os.getenv("SENTRY_API_BASE", "https://sentry.io/api/0")
SENTRY_AUTH_TOKEN = os.getenv("SENTRY_AUTH_TOKEN")
SENTRY_ORG_SLUG = os.getenv("SENTRY_ORG_SLUG")
SENTRY_PROJECT_SLUG = os.getenv("SENTRY_PROJECT_SLUG")
SENTRY_PROJECT_ID = os.getenv("SENTRY_PROJECT_ID")
SENTRY_ENVIRONMENT = os.getenv("SENTRY_ENVIRONMENT", "production")

SLACK_WEBHOOK_URL = os.getenv("SLACK_WEBHOOK_URL", "")
TEST_MODE = os.getenv("TEST_MODE", "true").lower() == "true"  # true=미전송, false=전송

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "gpt-4o-mini")
DEFAULT_MAX_ITEMS = int(os.getenv("MAX_ITEMS_PER_CATEGORY", "5"))

client = OpenAI(api_key=OPENAI_API_KEY) if (OPENAI_API_KEY and OpenAI) else None

# ==============================
# 시간 유틸 (KST ↔ UTC)
# ==============================
KST = dt.timezone(dt.timedelta(hours=9))
UTC = dt.timezone.utc

def kst_today() -> dt.date:
    return (dt.datetime.utcnow() + dt.timedelta(hours=9)).date()

def y_and_dby(date_opt: Optional[str]) -> Tuple[str, str]:
    """
    --date 가 있으면 그 날짜를 '어제'로 간주. 없으면 실제 어제/그제(KST).
    반환: ('YYYY-MM-DD', 'YYYY-MM-DD')
    """
    if date_opt:
        y = dt.datetime.strptime(date_opt, "%Y-%m-%d").date()
        dby = y - dt.timedelta(days=1)
    else:
        today = kst_today()
        y = today - dt.timedelta(days=1)
        dby = today - dt.timedelta(days=2)
    return y.strftime("%Y-%m-%d"), dby.strftime("%Y-%m-%d")

def kst_day_to_utc_range(day_str: str) -> Tuple[str, str]:
    """'YYYY-MM-DD'(KST)의 하루 → UTC ISO8601 Z 범위"""
    y, m, d = map(int, day_str.split("-"))
    start_kst = dt.datetime(y, m, d, 0, 0, 0, tzinfo=KST)
    end_kst   = dt.datetime(y, m, d, 23, 59, 59, tzinfo=KST)
    start_utc = start_kst.astimezone(UTC).isoformat().replace("+00:00", "Z")
    end_utc   = end_kst.astimezone(UTC).isoformat().replace("+00:00", "Z")
    return start_utc, end_utc

# ==============================
# Sentry API 공통
# ==============================
def _auth_headers() -> Dict[str, str]:
    if not SENTRY_AUTH_TOKEN:
        raise RuntimeError("Missing SENTRY_AUTH_TOKEN")
    return {"Authorization": f"Bearer {SENTRY_AUTH_TOKEN}"}

def _get(path: str, params: Optional[Dict[str, Any]] = None) -> Any:
    url = f"{SENTRY_API_BASE}{path}"
    resp = requests.get(url, headers=_auth_headers(), params=params, timeout=30)
    try:
        resp.raise_for_status()
    except requests.HTTPError as e:
        raise requests.HTTPError(f"{e} | url={resp.url} | body={resp.text}") from e
    return resp.json()

# ==============================
# Issues: 페이지네이션 전체 조회
# ==============================
def fetch_issues_all(start_kst: str, end_kst: str) -> List[Dict[str, Any]]:
    """
    Issues API에서 KST 하루 범위의 이슈 '전량' 조회 (per_page=100 + cursor).
    """
    path = f"/projects/{SENTRY_ORG_SLUG}/{SENTRY_PROJECT_SLUG}/issues/"
    url = f"{SENTRY_API_BASE}{path}"
    headers = _auth_headers()
    params = {
        "start": f"{start_kst}T00:00:00",
        "end": f"{end_kst}T23:59:59",
        "project": SENTRY_PROJECT_ID,
        "environment": SENTRY_ENVIRONMENT,
        "statsPeriod": "",
        "per_page": 100,
        # 정렬 기본: 최근 발생(기본) or freq, priority 등 필요시 변경
    }

    items: List[Dict[str, Any]] = []
    cursor = None
    while True:
        if cursor:
            params["cursor"] = cursor
        r = requests.get(url, headers=headers, params=params, timeout=30)
        r.raise_for_status()
        batch = r.json()
        if not isinstance(batch, list):
            break
        items.extend(batch)

        link = r.headers.get("Link", "")
        m = re.search(r'<[^>]+cursor="([^"]+)">;\s*rel="next";\s*results="(true|false)"', link)
        if not m or m.group(2) != "true":
            break
        cursor = m.group(1)
    return items

# ==============================
# Crash-Free (Sessions API)
# ==============================
def fetch_crash_free_rates_kst(day_kst: str) -> Dict[str, float]:
    """
    Sessions API에서 Crash-Free 비율(어제 KST 하루)을 %로 반환.
    1차: statsPeriod=1d + field=crash_free_rate(session|user)
    2차: start/end + interval=1h + field=...
    """
    start_utc_iso, end_utc_iso = kst_day_to_utc_range(day_kst)
    path = f"/organizations/{SENTRY_ORG_SLUG}/sessions/"

    def parse_rate(val: Optional[float]) -> Optional[float]:
        if val is None:
            return None
        return round(val * 100.0, 3)  # 0~1 → %

    def try_request(params: Dict[str, Any]) -> Dict[str, float]:
        data = _get(path, params=params)
        totals = data.get("totals") or {}
        s_rate = totals.get("crash_free_rate(session)")
        u_rate = totals.get("crash_free_rate(user)")
        # groups fallback
        if s_rate is None or u_rate is None:
            for g in data.get("groups", []):
                t = g.get("totals") or {}
                if s_rate is None:
                    s_rate = t.get("crash_free_rate(session)", s_rate)
                if u_rate is None:
                    u_rate = t.get("crash_free_rate(user)", u_rate)
        s_pct = parse_rate(s_rate) if s_rate is not None else None
        u_pct = parse_rate(u_rate) if u_rate is not None else None
        if s_pct is None and u_pct is None:
            raise ValueError("No crash_free_rate(session|user) in response")
        return {
            "crash_free_sessions_pct": s_pct if s_pct is not None else 100.0,
            "crash_free_users_pct":    u_pct if u_pct is not None else 100.0,
        }

    # A) statsPeriod=1d
    try:
        params_a = {
            "project": SENTRY_PROJECT_ID,
            "environment": SENTRY_ENVIRONMENT,
            "statsPeriod": "1d",
            "field": ["crash_free_rate(session)", "crash_free_rate(user)"],
            "includeTotals": 1,
            "includeSeries": 0,
        }
        return try_request(params_a)
    except requests.HTTPError:
        pass

    # B) start/end + interval
    params_b = {
        "project": SENTRY_PROJECT_ID,
        "environment": SENTRY_ENVIRONMENT,
        "start": start_utc_iso,
        "end": end_utc_iso,
        "interval": "1h",
        "field": ["crash_free_rate(session)", "crash_free_rate(user)"],
        "includeTotals": 1,
        "includeSeries": 0,
    }
    return try_request(params_b)

# ==============================
# 분류/지표
# ==============================
def classify_issues(yesterday: List[Dict[str, Any]], day_before: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    high = [i for i in yesterday if i.get("level") in ("fatal", "error")]
    new  = [i for i in yesterday if i.get("isNew")]
    prev_map = {i["id"]: i for i in day_before if i.get("id")}

    spike: List[Dict[str, Any]] = []
    for yi in yesterday:
        y_cnt = int(yi.get("count", 0) or 0)
        prev  = prev_map.get(yi.get("id"))
        if prev:
            d_cnt = int(prev.get("count", 0) or 0)
            if d_cnt > 0 and y_cnt >= d_cnt * 2:
                spike.append(yi)

    def sort_key(i): return int(i.get("count", 0) or 0)
    high.sort(key=sort_key, reverse=True)
    new.sort(key=sort_key, reverse=True)
    spike.sort(key=sort_key, reverse=True)
    return {"high_priority": high, "new": new, "spike": spike}

def build_summary_metrics(yesterday: List[Dict[str, Any]], day_before: List[Dict[str, Any]]) -> Dict[str, Any]:
    events_y = sum(int(i.get("count", 0) or 0) for i in yesterday)
    events_d = sum(int(i.get("count", 0) or 0) for i in day_before)
    events_diff = events_y - events_d

    type_counts: Dict[str, int] = {}
    for i in yesterday:
        t = i.get("type", "unknown")
        type_counts[t] = type_counts.get(t, 0) + 1
    type_kinds = len(type_counts)

    affected_users = sum(int(i.get("userCount", 0) or 0) for i in yesterday)

    return {
        "event_count": events_y,
        "event_count_diff": events_diff,
        "issue_type_kinds": type_kinds,
        "affected_users": affected_users,
        "issue_type_counts": type_counts,  # 원하면 하단 상세용
    }

def diff_emoji(value: int) -> str:
    return "📈" if value > 0 else ("📉" if value < 0 else "➖")

# ==============================
# 링크/포맷
# ==============================
def issue_permalink(issue: Dict[str, Any]) -> str:
    if issue.get("permalink"):
        return issue["permalink"]
    issue_id = issue.get("id")
    base = f"https://sentry.io/organizations/{SENTRY_ORG_SLUG}/issues/{issue_id}/"
    suffix = f"?project={SENTRY_PROJECT_ID}&environment={SENTRY_ENVIRONMENT}" if SENTRY_PROJECT_ID else ""
    return base + suffix

def format_issue_line(issue: Dict[str, Any], comment_map: Dict[str, Dict[str, Any]]) -> str:
    iid = issue.get("id")
    link = issue_permalink(issue)
    title = issue.get("title") or issue.get("shortId") or iid
    cnt = int(issue.get("count", 0) or 0)
    users = int(issue.get("userCount", 0) or 0)
    line = f"• <{link}|{title}> — {cnt} events, {users} users"
    cm = comment_map.get(iid)
    if cm:
        sev = (cm.get("severity") or "").upper()
        act = cm.get("action") or ""
        cmt = (cm.get("comment") or "").replace("**", "*")
        bits = []
        if sev: bits.append(f"*Severity:* {sev}")
        if act: bits.append(f"*Action:* {act}")
        if cmt: bits.append(f"*Note:* {cmt}")
        if bits:
            line += "\n  " + " | ".join(bits)
    return line

# ==============================
# AI 코멘트(견고화)
# ==============================
def ai_comment_issues(categories: Dict[str, List[Dict[str, Any]]],
                      date_str: str,
                      max_items: int,
                      debug: bool = False) -> Dict[str, Dict[str, Any]]:
    if not client:
        return {}

    def brief(issue: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": issue.get("id"),
            "shortId": issue.get("shortId"),
            "title": issue.get("title"),
            "level": issue.get("level"),
            "count": int(issue.get("count", 0) or 0),
            "userCount": int(issue.get("userCount", 0) or 0),
            "culprit": issue.get("culprit"),
            "isNew": issue.get("isNew", False),
            "type": issue.get("type"),
        }

    payload = {
        "date": date_str,
        "high_priority": [brief(i) for i in categories["high_priority"][:max_items]],
        "new": [brief(i) for i in categories["new"][:max_items]],
        "spike": [brief(i) for i in categories["spike"][:max_items]],
    }

    system = (
        "당신은 시니어 모바일 크래시/SRE 엔지니어입니다. "
        "반드시 JSON 객체만 반환하십시오(그 외 텍스트 금지). "
        "키는 반드시 각 이슈의 'id' 여야 합니다. "
        "텍스트에는 Slack mrkdwn을 사용할 수 있으며 굵게 표기는 단일 별표 *텍스트* 만 사용하십시오."
    )
    user = (
        "각 이슈에 대해 한국어로 간단한 평가를 작성해 주세요. "
        "다음 필드를 포함하여 JSON 객체(키=issue id)로만 반환하세요:\n"
        '- "severity": "high" | "medium" | "low"\n'
        '- "action": 즉시 적용 가능한 한 줄 해결/대응 방안(예: 널 가드 추가, 롤백, 재시도/백오프, SDK 버전 고정/롤백, 로그/브레드크럼 추가, 플래그로 임시 차단 등)\n'
        '- "comment": 한 줄 원인 추정/트리아지 힌트\n\n'
        f"DATA:\n{json.dumps(payload, ensure_ascii=False)}"
    )

    raw = None
    try:
        # 일부 모델에서만 동작; 미지원이면 무시됨
        resp = client.chat.completions.create(
            model=AI_MODEL,
            messages=[{"role":"system","content":system},{"role":"user","content":user}],
            temperature=0.2,
            response_format={"type":"json_object"}
        )
        raw = resp.choices[0].message.content.strip()
    except Exception as e:
        if debug: print(f"[ai_comment_issues] OpenAI 호출 실패: {e}")
        return {}

    # 코드펜스 제거
    txt = raw
    if txt.startswith("```"):
        i = txt.find("{"); j = txt.rfind("}")
        if i != -1 and j != -1 and j > i:
            txt = txt[i:j+1]

    try:
        data = json.loads(txt)
    except Exception as e:
        if debug:
            print("[ai_comment_issues] JSON 파싱 실패. 원문:")
            print(raw)
            print("에러:", e)
        return {}

    # 키 검증/보정: 기대 id 집합
    expected_ids = {i.get("id") for b in ("high_priority","new","spike") for i in categories[b][:max_items]}
    expected_ids = {x for x in expected_ids if x}

    if all(k in expected_ids for k in data.keys()):
        return data

    # 혹시 잘못된 키(예: shortId/title)를 쓴 경우, 값 내부의 id 또는 역매핑으로 보정
    fixed: Dict[str, Dict[str, Any]] = {}
    index_by = {}
    for b in ("high_priority","new","spike"):
        for iss in categories[b][:max_items]:
            if iss.get("shortId"):
                index_by[f"shortId::{iss['shortId']}"] = iss["id"]
            if iss.get("title"):
                index_by[f"title::{iss['title']}"] = iss["id"]

    for k, v in data.items():
        vid = v.get("id") if isinstance(v, dict) else None
        if vid in expected_ids:
            fixed[vid] = v; continue
        cand = index_by.get(f"shortId::{k}") or index_by.get(f"title::{k}")
        if cand:
            fixed[cand] = v; continue
        if k in expected_ids:
            fixed[k] = v

    if not fixed and debug:
        print("[ai_comment_issues] 키 보정 실패. keys:", list(data.keys()))
        print("expected:", list(expected_ids))
    return fixed or {}

# ==============================
# Slack Blocks
# ==============================
def build_slack_payload(date_str: str,
                        metrics: Dict[str, Any],
                        crash_free: Dict[str, float],
                        categories: Dict[str, List[Dict[str, Any]]],
                        comment_map: Dict[str, Dict[str, Any]],
                        max_items: int,
                        expert_summary: Optional[str]) -> Dict[str, Any]:
    def section_for(label: str, key: str) -> Dict[str, Any]:
        issues = categories[key][:max_items]
        if not issues:
            text = f"*{label}*: 없음 ✅"
        else:
            lines = [format_issue_line(i, comment_map) for i in issues]
            text = f"*{label}*:\n" + "\n".join(lines)
        return {"type":"section","text":{"type":"mrkdwn","text":text}}

    blocks: List[Dict[str, Any]] = [
        {"type":"header","text":{"type":"plain_text","text":f"Android 일간 리포트 · {date_str}"}},
        {
            "type":"section",
            "text":{"type":"mrkdwn","text":(
                "*📊 기본 지표*\n\n"
                f"- 이슈 발생 횟수: {metrics['event_count']:,}건 ({diff_emoji(metrics['event_count_diff'])} {metrics['event_count_diff']:+,}건)\n"
                f"- 크래시 이슈 종류: {metrics['issue_type_kinds']}개\n"
                f"- 영향받은 사용자(어제): {metrics['affected_users']:,}명\n"
                f"- Crash-Free Sessions(어제): {crash_free['crash_free_sessions_pct']}%\n"
                f"- Crash-Free Users(어제): {crash_free['crash_free_users_pct']}%\n"
            )}
        },
        {"type":"divider"},
        section_for("🚨 우선순위 높은 이슈", "high_priority"),
        {"type":"divider"},
        section_for("🆕 신규 이슈", "new"),
        {"type":"divider"},
        section_for("📈 급증 이슈", "spike"),
    ]

    if expert_summary:
        blocks.insert(2, {"type":"section","text":{"type":"mrkdwn","text":f"*🧠 전문가 코멘트*\n{expert_summary}"}})

    blocks.append({
        "type":"actions",
        "elements":[{
            "type":"button",
            "text":{"type":"plain_text","text":"Sentry 대시보드 열기"},
            "url": f"https://sentry.io/organizations/{SENTRY_ORG_SLUG}/projects/{SENTRY_PROJECT_SLUG}/?environment={SENTRY_ENVIRONMENT}"
        }]
    })
    return {"blocks": blocks}

# ==============================
# 전문가 요약(한국어)
# ==============================
def ai_overall_summary(date_str: str,
                       metrics: Dict[str, Any],
                       crash_free: Dict[str, float],
                       categories: Dict[str, List[Dict[str, Any]]]) -> Optional[str]:
    if not client:
        return None
    summary_data = {
        "date": date_str,
        "event_count": metrics["event_count"],
        "event_count_diff": metrics["event_count_diff"],
        "issue_type_kinds": metrics["issue_type_kinds"],
        "affected_users": metrics["affected_users"],
        "crash_free_sessions_pct": crash_free["crash_free_sessions_pct"],
        "crash_free_users_pct": crash_free["crash_free_users_pct"],
        "top_high_priority_titles": [ (i.get("title") or i.get("shortId") or i.get("id")) for i in categories["high_priority"][:3] ],
        "top_spike_titles": [ (i.get("title") or i.get("shortId") or i.get("id")) for i in categories["spike"][:3] ],
        "counts": {
            "high_priority": len(categories["high_priority"]),
            "new": len(categories["new"]),
            "spike": len(categories["spike"]),
        }
    }
    system = (
        "당신은 시니어 모바일 크래시/SRE 엔지니어입니다. "
        "Slack mrkdwn 형식으로 간결하고 실행 중심의 요약을 작성하세요. "
        "단일 별표 *텍스트* 로만 굵게 표시하세요. "
        "수치를 단순 나열하지 말고, 의미/원인 추정/우선순위/즉시 대응 방안을 제시하세요. "
        "불릿 4~6개로 제한하세요."
    )
    user = (
        "다음 JSON을 분석해 종합 코멘트를 한국어로 작성하세요.\n"
        "- 가장 영향력이 큰 문제(Top high/spike)에 집중\n"
        "- 팀이 오늘 바로 할 수 있는 액션 제안\n\n"
        f"DATA:\n{json.dumps(summary_data, ensure_ascii=False)}"
    )
    try:
        resp = client.chat.completions.create(
            model=AI_MODEL,
            messages=[{"role":"system","content":system},{"role":"user","content":user}],
            temperature=0.2,
        )
        text = resp.choices[0].message.content.strip()
        return text.replace("**", "*")
    except Exception:
        return None

# ==============================
# Slack 전송
# ==============================
def send_to_slack(blocks_payload: Dict[str, Any], fallback_text: str) -> None:
    if TEST_MODE:
        print("[TEST_MODE=true] Slack 전송 생략. (프리뷰)")
        print(json.dumps(blocks_payload, ensure_ascii=False, indent=2))
        return
    if not SLACK_WEBHOOK_URL:
        print("[WARN] SLACK_WEBHOOK_URL 미설정. 전송 불가. 프리뷰 출력.")
        print(json.dumps(blocks_payload, ensure_ascii=False, indent=2))
        return
    payload = {"text": fallback_text, **blocks_payload}
    resp = requests.post(
        SLACK_WEBHOOK_URL,
        data=json.dumps(payload),
        headers={"Content-Type": "application/json"},
        timeout=15
    )
    resp.raise_for_status()
    print("[INFO] Slack 전송 성공")

# ==============================
# 메인
# ==============================
def main():
    parser = argparse.ArgumentParser(description="Actionable Sentry Daily Report → Slack")
    parser.add_argument("--date", help="기준일(YYYY-MM-DD, KST). 미지정 시 어제.")
    parser.add_argument("--no-ai", action="store_true", help="AI 코멘트 비활성화")
    parser.add_argument("--max", type=int, default=DEFAULT_MAX_ITEMS, help="카테고리별 표시 최대 이슈 수")
    args = parser.parse_args()

    # 필수 env 확인
    for k, v in {
        "SENTRY_AUTH_TOKEN": SENTRY_AUTH_TOKEN,
        "SENTRY_ORG_SLUG": SENTRY_ORG_SLUG,
        "SENTRY_PROJECT_SLUG": SENTRY_PROJECT_SLUG,
        "SENTRY_PROJECT_ID": SENTRY_PROJECT_ID,
    }.items():
        if not v:
            raise SystemExit(f"[ERROR] Missing env: {k}")

    max_items = args.max
    y_kst, dby_kst = y_and_dby(args.date)

    # 이슈 수집(전량)
    y_issues = fetch_issues_all(y_kst, y_kst)
    d_issues = fetch_issues_all(dby_kst, dby_kst)

    # 분류/요약
    categories = classify_issues(y_issues, d_issues)
    metrics = build_summary_metrics(y_issues, d_issues)
    crash_free = fetch_crash_free_rates_kst(y_kst)

    # AI 코멘트/요약
    comment_map: Dict[str, Dict[str, Any]] = {}
    expert_summary: Optional[str] = None
    if (not args.no_ai) and client:
        comment_map = ai_comment_issues(categories, y_kst, max_items, debug=False)
        expert_summary = ai_overall_summary(y_kst, metrics, crash_free, categories)

    # Slack Blocks
    blocks = build_slack_payload(
        date_str=y_kst,
        metrics=metrics,
        crash_free=crash_free,
        categories=categories,
        comment_map=comment_map,
        max_items=max_items,
        expert_summary=expert_summary
    )

    fallback = (
        f"Android 일간 리포트 {y_kst} — Events {metrics['event_count']:,} "
        f"({metrics['event_count_diff']:+,}), Crash-Free S {crash_free['crash_free_sessions_pct']}% "
        f"U {crash_free['crash_free_users_pct']}%"
    )
    send_to_slack(blocks, fallback)

if __name__ == "__main__":
    main()