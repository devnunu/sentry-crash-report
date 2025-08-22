#!/usr/bin/env python3
"""
Actionable Sentry Daily Report → Slack (Webhook)

기능
- KST 기준 '어제'의 Sentry 이슈를 우선순위/신규/급증으로 리스트업 (링크 포함)
- Release Health(Sessions API)에서 Crash-Free Sessions/Users % 수집
- (선택) OpenAI로 각 이슈별 코멘트와 상단 전문가 요약 코멘트 생성
- Slack Webhook으로 Block Kit 메시지 전송
  - TEST_MODE=true  → 전송 안 함(프리뷰만 출력)
  - TEST_MODE=false → 실제 전송

사용
    pip install requests python-dotenv
    # (옵션) pip install openai
    python actionable_sentry_report.py --max 5 --date 2025-08-21

환경변수(.env)
    SENTRY_AUTH_TOKEN, SENTRY_ORG_SLUG, SENTRY_PROJECT_SLUG, SENTRY_PROJECT_ID, SENTRY_ENVIRONMENT
    (옵션) SENTRY_API_BASE (기본: https://sentry.io/api/0)
    (옵션) OPENAI_API_KEY, AI_MODEL (기본: gpt-4o-mini)
    (옵션) MAX_ITEMS_PER_CATEGORY (기본: 5)
    SLACK_WEBHOOK_URL
    TEST_MODE ("true"면 미전송, "false"면 전송)
"""

import argparse
import datetime as dt
import json
import os
from typing import Any, Dict, List, Optional, Tuple

import requests
from dotenv import load_dotenv

# -------- Optional OpenAI --------
try:
    from openai import OpenAI
except Exception:
    OpenAI = None

# -------- Env --------
load_dotenv()

SENTRY_API_BASE = os.getenv("SENTRY_API_BASE", "https://sentry.io/api/0")
SENTRY_AUTH_TOKEN = os.getenv("SENTRY_AUTH_TOKEN")
SENTRY_ORG_SLUG = os.getenv("SENTRY_ORG_SLUG")
SENTRY_PROJECT_SLUG = os.getenv("SENTRY_PROJECT_SLUG")
SENTRY_PROJECT_ID = os.getenv("SENTRY_PROJECT_ID")
SENTRY_ENVIRONMENT = os.getenv("SENTRY_ENVIRONMENT", "production")

SLACK_WEBHOOK_URL = os.getenv("SLACK_WEBHOOK_URL", "")
TEST_MODE = os.getenv("TEST_MODE", "true").lower() == "true"   # ← true=미전송, false=전송

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
AI_MODEL = os.getenv("AI_MODEL", "gpt-4o-mini")
DEFAULT_MAX_ITEMS = int(os.getenv("MAX_ITEMS_PER_CATEGORY", "5"))

client = OpenAI(api_key=OPENAI_API_KEY) if (OPENAI_API_KEY and OpenAI) else None

# -------- Time Utils (KST↔UTC) --------
KST = dt.timezone(dt.timedelta(hours=9))
UTC = dt.timezone.utc

def kst_today() -> dt.date:
    return (dt.datetime.utcnow() + dt.timedelta(hours=9)).date()

def y_and_dby(date_opt: Optional[str]) -> Tuple[str, str]:
    """date_opt가 있으면 그 날을 '어제'로 가정, 없으면 실제 어제/그제(KST)"""
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

# -------- Sentry API --------
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

def fetch_issues(start_kst: str, end_kst: str) -> List[Dict[str, Any]]:
    """Issues API: 기간(KST)으로 필터"""
    params = {
        "start": f"{start_kst}T00:00:00",
        "end": f"{end_kst}T23:59:59",
        "project": SENTRY_PROJECT_ID,
        "environment": SENTRY_ENVIRONMENT,
        "statsPeriod": "",
    }
    return _get(f"/projects/{SENTRY_ORG_SLUG}/{SENTRY_PROJECT_SLUG}/issues/", params=params)

def fetch_crash_free_rates_kst(day_kst: str) -> Dict[str, float]:
    """
    Sessions API에서 Crash-Free % 추출
    1) statsPeriod=1d + field=crash_free_rate(session|user)
    2) 실패시 start/end(UTC) + interval=1h
    """
    start_utc_iso, end_utc_iso = kst_day_to_utc_range(day_kst)
    path = f"/organizations/{SENTRY_ORG_SLUG}/sessions/"

    def parse_rate(val: Optional[float]) -> Optional[float]:
        if val is None: return None
        return round(val * 100.0, 3)  # 비율 → %

    def try_request(params: Dict[str, Any]) -> Dict[str, float]:
        data = _get(path, params=params)
        totals = data.get("totals") or {}
        s_rate = totals.get("crash_free_rate(session)")
        u_rate = totals.get("crash_free_rate(user)")

        # fallback: groups[].totals 평균
        if s_rate is None or u_rate is None:
            for g in data.get("groups", []):
                t = g.get("totals") or {}
                s_rate = s_rate if s_rate is not None else t.get("crash_free_rate(session)")
                u_rate = u_rate if u_rate is not None else t.get("crash_free_rate(user)")

        s_pct = parse_rate(s_rate) if s_rate is not None else None
        u_pct = parse_rate(u_rate) if u_rate is not None else None
        if s_pct is None and u_pct is None:
            raise ValueError("No crash_free_rate(session|user) in response")

        return {
            "crash_free_sessions_pct": s_pct if s_pct is not None else 100.0,
            "crash_free_users_pct":    u_pct if u_pct is not None else 100.0,
        }

    # A: statsPeriod=1d
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

    # B: start/end + interval=1h
    params_b = {
        "project": SENTRY_PROJECT_ID,
        "environment": SENTRY_ENVIRONMENT,
        "start": start_utc_iso,
        "end":   end_utc_iso,
        "interval": "1h",
        "field": ["crash_free_rate(session)", "crash_free_rate(user)"],
        "includeTotals": 1,
        "includeSeries": 0,
    }
    return try_request(params_b)

def issue_permalink(issue: Dict[str, Any]) -> str:
    if issue.get("permalink"):
        return issue["permalink"]
    issue_id = issue.get("id")
    base = f"https://sentry.io/organizations/{SENTRY_ORG_SLUG}/issues/{issue_id}/"
    suffix = f"?project={SENTRY_PROJECT_ID}&environment={SENTRY_ENVIRONMENT}" if SENTRY_PROJECT_ID else ""
    return base + suffix

# -------- Aggregate / Classify --------
def classify_issues(yesterday: List[Dict[str, Any]], day_before: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    high = [i for i in yesterday if i.get("level") in ["fatal", "error"]]
    new  = [i for i in yesterday if i.get("isNew")]
    prev_map = {i["id"]: i for i in day_before}
    spike: List[Dict[str, Any]] = []
    for yi in yesterday:
        y_cnt = int(yi.get("count", 0) or 0)
        prev  = prev_map.get(yi["id"])
        if prev:
            d_cnt = int(prev.get("count", 0) or 0)
            if d_cnt > 0 and y_cnt >= d_cnt * 2:
                spike.append(yi)

    def sort_key(i): return int(i.get("count", 0) or 0)
    for arr in (high, new, spike):
        arr.sort(key=sort_key, reverse=True)
    return {"high_priority": high, "new": new, "spike": spike}

def build_summary_metrics(yesterday: List[Dict[str, Any]], day_before: List[Dict[str, Any]]) -> Dict[str, Any]:
    issue_count_y = len(yesterday)
    issue_count_d = len(day_before)
    affected_users = sum(int(i.get("userCount", 0) or 0) for i in yesterday)
    issue_type_counts: Dict[str, int] = {}
    for i in yesterday:
        t = i.get("type", "unknown")
        issue_type_counts[t] = issue_type_counts.get(t, 0) + 1
    return {
        "issue_count": issue_count_y,
        "issue_count_diff": issue_count_y - issue_count_d,
        "affected_users": affected_users,
        "issue_type_counts": issue_type_counts,
    }

# -------- AI Comments --------
def ai_comment_issues(categories: Dict[str, List[Dict[str, Any]]],
                      date_str: str,
                      max_items: int,
                      debug: bool = False) -> Dict[str, Dict[str, Any]]:
    """
    각 이슈별 {severity, action, comment} 반환.
    - OpenAI 응답을 강제로 JSON 오브젝트로 요청(response_format).
    - 코드펜스/앞뒤 잡음 제거 및 키 보정(id/shortId/title 매칭) 수행.
    - 실패 시 원인 간단 로깅(옵션).
    """
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
        "new":           [brief(i) for i in categories["new"][:max_items]],
        "spike":         [brief(i) for i in categories["spike"][:max_items]],
    }

    # 한국어 + 키 규칙(반드시 id를 키로)
    system = (
        "당신은 시니어 모바일 크래시/SRE 엔지니어입니다. "
        "반드시 JSON 객체만 반환하십시오(그 외 텍스트 금지). "
        "키는 반드시 각 이슈의 'id' 여야 합니다(다른 키 사용 금지). "
        "텍스트에는 Slack mrkdwn을 사용할 수 있으며 굵게 표기는 단일 별표 *텍스트* 만 사용하십시오."
    )
    user = (
        "각 이슈에 대해 한국어로 간단한 평가를 작성해 주세요. "
        "반드시 다음 필드를 포함하세요:\n"
        '- "severity": "high" | "medium" | "low"\n'
        '- "action": 즉시 적용 가능한 한 줄 해결/대응 방안(예: 널 가드 추가, 롤백, 재시도/백오프, SDK 버전 고정/롤백, 로그/브레드크럼 추가, 플래그로 임시 차단 등)\n'
        '- "comment": 한 줄 원인 추정/트리아지 힌트\n\n'
        "반드시 JSON 객체(키=issue id)로만 반환하세요. 예:\n"
        '{ "1234567890": {"severity":"high","action":"롤백 수행","comment":"릴리스 버그 추정"}, "...": {...} }\n\n'
        f"DATA:\n{json.dumps(payload, ensure_ascii=False)}"
    )

    raw = None
    try:
        # ✨ 가능한 모델에서는 JSON 오브젝트 강제
        resp = client.chat.completions.create(
            model=AI_MODEL,
            messages=[{"role":"system","content":system},{"role":"user","content":user}],
            temperature=0.2,
            response_format={"type": "json_object"}  # 지원 모델에서만 작동; 미지원이면 무시될 수 있음
        )
        raw = resp.choices[0].message.content.strip()
    except Exception as e:
        if debug: print(f"[ai_comment_issues] OpenAI 호출 실패: {e}")
        return {}

    # --- 코드펜스 제거 및 JSON만 추출 ---
    txt = raw
    # 흔한 패턴 제거
    if txt.startswith("```"):
        # ```json\n{...}\n``` 또는 ```\n{...}\n``` 패턴
        i = txt.find("{")
        j = txt.rfind("}")
        if i != -1 and j != -1 and j > i:
            txt = txt[i:j+1]

    # --- JSON 파싱 ---
    try:
        data = json.loads(txt)
    except Exception as e:
        if debug:
            print("[ai_comment_issues] JSON 파싱 실패. 원문 출력:")
            print(raw)
            print(f"에러: {e}")
        return {}

    # --- 키 보정: 혹시 id 대신 shortId/title로 내려오면 id로 재매핑 ---
    # 기대하는 키셋
    expected_ids = {i.get("id") for i in categories["high_priority"][:max_items]}
    expected_ids |= {i.get("id") for i in categories["new"][:max_items]}
    expected_ids |= {i.get("id") for i in categories["spike"][:max_items]}
    expected_ids = {x for x in expected_ids if x}

    # 이미 키가 id들이면 그대로 사용
    if all(k in expected_ids for k in data.keys()):
        return data

    # 아니라면 값 안에 id/shortId/title를 찾아서 매칭
    fixed: Dict[str, Dict[str, Any]] = {}
    index_by = {}
    # 역색인: shortId/title -> id
    for bucket in ("high_priority", "new", "spike"):
        for iss in categories[bucket][:max_items]:
            if iss.get("shortId"):
                index_by[f"shortId::{iss['shortId']}"] = iss["id"]
            if iss.get("title"):
                index_by[f"title::{iss['title']}"] = iss["id"]

    for k, v in data.items():
        # 1) 값 안에 id가 들어있다면 그걸 신뢰
        vid = v.get("id") if isinstance(v, dict) else None
        if vid in expected_ids:
            fixed[vid] = v; continue
        # 2) 키를 shortId/title로 사용했을 가능성
        cand = index_by.get(f"shortId::{k}") or index_by.get(f"title::{k}")
        if cand:
            fixed[cand] = v; continue
        # 3) 마지막 보정: k가 숫자/문자 혼용이면 문자열화
        if k in expected_ids:
            fixed[k] = v

    if not fixed and debug:
        print("[ai_comment_issues] 키 보정 후에도 매칭 실패. 원문 키들:", list(data.keys()))
        print("기대 id들:", list(expected_ids))

    return fixed or {}

def ai_overall_summary(date_str: str,
                       metrics: Dict[str, Any],
                       crash_free: Dict[str, float],
                       categories: Dict[str, List[Dict[str, Any]]]) -> Optional[str]:
    """상단 전문가 요약(선택). Slack mrkdwn *bold*만 사용하도록 지시."""
    if not client:
        return None
    summary_data = {
        "date": date_str,
        "issue_count": metrics["issue_count"],
        "issue_count_diff": metrics["issue_count_diff"],
        "affected_users": metrics["affected_users"],
        "crash_free_sessions_pct": crash_free["crash_free_sessions_pct"],
        "crash_free_users_pct": crash_free["crash_free_users_pct"],
        "counts": {
            "high_priority": len(categories["high_priority"]),
            "new": len(categories["new"]),
            "spike": len(categories["spike"]),
        }
    }
    system = (
        "당신은 시니어 모바일 크래시/SRE 엔지니어입니다. "
        "Slack mrkdwn 형식으로 짧고 실행 중심의 요약을 작성하세요. "
        "굵게 표기는 단일 별표 *텍스트* 를 사용하세요. "
        "불릿 포인트 4~6개로 제한하세요. "
        "단순히 수치를 반복하지 말고, 수치를 근거로 한 '분석'과 '의견'을 강조하세요."
    )
    user = (
        "다음 일간 크래시 리포트(JSON)를 분석하고, 종합적인 전문가 코멘트를 작성해 주세요.\n"
        "- 수치 자체를 단순히 나열하지 마세요.\n"
        "- 대신 수치를 근거로 *왜 중요한지*, *어떤 의미인지*, *어떤 대응이 필요한지*를 설명하세요.\n"
        "- 예시: 'Crash-Free Rate가 99.9%로 높지만, 특정 고우선 이슈 2개가 전체 사용자 경험에 큰 영향을 주고 있음' 처럼.\n"
        "- 팀에 바로 공유할 수 있는 실행 방안을 제안하세요.\n\n"
        f"DATA:\n{json.dumps(summary_data, ensure_ascii=False)}"
    )
    try:
        resp = client.chat.completions.create(
            model=AI_MODEL,
            messages=[{"role":"system","content":system},{"role":"user","content":user}],
            temperature=0.2,
        )
        text = resp.choices[0].message.content.strip()
        # 혹시 **...** 를 썼다면 *...* 로 교체
        text = text.replace("**", "*")
        return text
    except Exception:
        return None

# -------- Slack Blocks --------
def format_issue_line(issue: Dict[str, Any], comment_map: Dict[str, Dict[str, Any]]) -> str:
    iid   = issue.get("id")
    link  = issue_permalink(issue)
    title = issue.get("title") or issue.get("shortId") or iid
    cnt   = int(issue.get("count", 0) or 0)
    users = int(issue.get("userCount", 0) or 0)
    line  = f"• <{link}|{title}> — {cnt} events, {users} users"
    cm    = comment_map.get(iid)
    if cm:
        sev = (cm.get("severity") or "").upper()
        act = cm.get("action") or ""
        cmt = (cm.get("comment") or "").replace("**", "*")
        extras = []
        if sev: extras.append(f"*Severity:* {sev}")
        if act: extras.append(f"*Action:* {act}")
        if cmt: extras.append(f"*Note:* {cmt}")
        if extras:
            line += "\n  " + " | ".join(extras)
    return line

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
        {"type":"section","text":{"type":"mrkdwn","text":(
            "*📊 기본 지표*\n\n"
            f"- 총 이슈 수: {metrics['issue_count']} (Δ {metrics['issue_count_diff']:+})\n"
            f"- 영향받은 사용자: {metrics['affected_users']}명\n"
            f"- Crash-Free Sessions: {crash_free['crash_free_sessions_pct']}%\n"
            f"- Crash-Free Users: {crash_free['crash_free_users_pct']}%\n"
        )}},
        {"type":"divider"},
        section_for("🚨 우선순위 높은 이슈", "high_priority"),
        {"type":"divider"},
        section_for("🆕 신규 이슈", "new"),
        {"type":"divider"},
        section_for("📈 급증 이슈", "spike"),
    ]

    if expert_summary:
        blocks.insert(2, {"type":"section","text":{"type":"mrkdwn","text":f"*🧠 전문가 코멘트*\n{expert_summary}"}})

    # 대시보드 버튼
    blocks.append({
        "type":"actions",
        "elements":[{
            "type":"button",
            "text":{"type":"plain_text","text":"Sentry 대시보드 열기"},
            "url": f"https://sentry.io/organizations/{SENTRY_ORG_SLUG}/projects/{SENTRY_PROJECT_SLUG}/?environment={SENTRY_ENVIRONMENT}"
        }]
    })
    return {"blocks": blocks}

# -------- Slack Send --------
def send_to_slack(blocks_payload: Dict[str, Any], fallback_text: str) -> None:
    """
    TEST_MODE=true  → 전송 안 함(프리뷰만)
    TEST_MODE=false → 실제 전송
    """
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
    try:
        resp.raise_for_status()
        print("[INFO] Slack 전송 성공")
    except requests.HTTPError as e:
        print(f"[ERROR] Slack 전송 실패: {e} | body={resp.text}")

# -------- Main --------
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

    # 데이터 수집
    y_issues = fetch_issues(y_kst, y_kst)
    d_issues = fetch_issues(dby_kst, dby_kst)

    categories = classify_issues(y_issues, d_issues)
    metrics    = build_summary_metrics(y_issues, d_issues)
    crash_free = fetch_crash_free_rates_kst(y_kst)

    # AI
    comment_map: Dict[str, Dict[str, Any]] = {}
    expert_summary: Optional[str] = None
    if (not args.no_ai) and client:
        comment_map = ai_comment_issues(categories, y_kst, max_items)
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
        f"Android 일간 리포트 {y_kst} — Crash-Free Sessions "
        f"{crash_free['crash_free_sessions_pct']}%, Users {crash_free['crash_free_users_pct']}%"
    )
    send_to_slack(blocks, fallback)

if __name__ == "__main__":
    main()