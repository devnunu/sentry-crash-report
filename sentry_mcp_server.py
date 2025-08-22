import datetime as dt
import json
import os
from typing import Dict, Any, List, Optional

import requests
from dotenv import load_dotenv
# FastMCP
from fastmcp import FastMCP, Context
# OpenAI (선택: 기존 프롬프트 분석 재사용)
from openai import OpenAI

# ======================================
# 기본 설정
# ======================================
load_dotenv()

SENTRY_API_BASE = os.getenv("SENTRY_API_BASE", "https://sentry.io/api/0")
SENTRY_AUTH_TOKEN = os.getenv("SENTRY_AUTH_TOKEN")
SENTRY_ORG_SLUG = os.getenv("SENTRY_ORG_SLUG")
SENTRY_PROJECT_SLUG = os.getenv("SENTRY_PROJECT_SLUG")
SENTRY_PROJECT_ID = os.getenv("SENTRY_PROJECT_ID")
SENTRY_ENVIRONMENT = os.getenv("SENTRY_ENVIRONMENT", "production")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

# OpenAI 클라이언트 (선택적)
openai_client: Optional[OpenAI] = None
if OPENAI_API_KEY:
    openai_client = OpenAI(api_key=OPENAI_API_KEY)

mcp = FastMCP("sentry-mcp-server")


# ======================================
# 내부 유틸
# ======================================
def _auth_headers() -> Dict[str, str]:
    if not SENTRY_AUTH_TOKEN:
        raise RuntimeError("Missing SENTRY_AUTH_TOKEN")
    return {"Authorization": f"Bearer {SENTRY_AUTH_TOKEN}"}


def sentry_get(path: str, params: Optional[Dict[str, Any]] = None) -> Any:
    url = f"{SENTRY_API_BASE}{path}"
    resp = requests.get(url, headers=_auth_headers(), params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


def fetch_issues(start_date: str, end_date: str) -> List[Dict[str, Any]]:
    """
    start_date, end_date: 'YYYY-MM-DD'
    """
    params = {
        "start": f"{start_date}T00:00:00",
        "end": f"{end_date}T23:59:59",
        "project": SENTRY_PROJECT_ID,
        "environment": SENTRY_ENVIRONMENT,
        "statsPeriod": "",  # 명시적 기간 사용
    }
    return sentry_get(f"/projects/{SENTRY_ORG_SLUG}/{SENTRY_PROJECT_SLUG}/issues/", params=params)


def build_report(yesterday: dt.date, day_before: dt.date) -> Dict[str, Any]:
    y_str = yesterday.strftime("%Y-%m-%d")
    d_str = day_before.strftime("%Y-%m-%d")

    yesterday_issues = fetch_issues(y_str, y_str)
    day_before_issues = fetch_issues(d_str, d_str)

    issue_count_yesterday = len(yesterday_issues)
    issue_count_day_before = len(day_before_issues)
    diff_issue_count = issue_count_yesterday - issue_count_day_before

    high_priority = [i for i in yesterday_issues if i.get("level") in ["fatal", "error"]]
    new_issues = [i for i in yesterday_issues if i.get("isNew")]

    # 급증 이슈: 전일 대비 2배 이상 발생
    spike_issues: List[Dict[str, Any]] = []
    prev_map = {i["id"]: i for i in day_before_issues}
    for yi in yesterday_issues:
        count_y = int(yi.get("count", 0) or 0)
        prev = prev_map.get(yi["id"])
        if prev:
            count_d = int(prev.get("count", 0) or 0)
            if count_d > 0 and count_y >= count_d * 2:
                spike_issues.append(yi)

    crash_rate = f"{(issue_count_yesterday / max(1, issue_count_day_before)):.2f}"
    affected_users = sum(int(i.get("userCount", 0) or 0) for i in yesterday_issues)

    issue_type_counts: Dict[str, int] = {}
    for i in yesterday_issues:
        t = i.get("type", "unknown")
        issue_type_counts[t] = issue_type_counts.get(t, 0) + 1

    report = {
        "date": y_str,
        "issue_count": issue_count_yesterday,
        "issue_count_diff": diff_issue_count,
        "crash_rate": crash_rate,
        "affected_users": affected_users,
        "issue_type_counts": issue_type_counts,
        "high_priority_count": len(high_priority),
        "new_issue_count": len(new_issues),
        "spike_issue_count": len(spike_issues),
        "high_priority": high_priority,
        "new_issues": new_issues,
        "spike_issues": spike_issues,
        # 편의 필드
        "dashboard_url": f"https://sentry.io/organizations/{SENTRY_ORG_SLUG}/projects/{SENTRY_PROJECT_SLUG}/?environment={SENTRY_ENVIRONMENT}",
    }
    return report


def _default_dates(reference_tz_offset_hours: int = 9) -> (dt.date, dt.date):
    """
    KST(+09:00) 기준으로 '어제/그제'를 산출.
    MCP 클라이언트가 다른 TZ여도 일단 서버에서 고정 규칙 적용.
    """
    now = dt.datetime.utcnow() + dt.timedelta(hours=reference_tz_offset_hours)
    today_local = now.date()
    yesterday = today_local - dt.timedelta(days=1)
    day_before = today_local - dt.timedelta(days=2)
    return yesterday, day_before


# ======================================
# MCP 툴들
# ======================================

@mcp.tool
def sentry_fetch_issues(
    start_date: str,
    end_date: str,
) -> List[Dict[str, Any]]:
    """
    Sentry 이슈 원자료를 기간으로 조회합니다. 날짜 형식: 'YYYY-MM-DD'.
    반환: 이슈 리스트(JSON)
    """
    return fetch_issues(start_date, end_date)


@mcp.tool
def sentry_daily_report(
    date: Optional[str] = None,
    tz_offset_hours: int = 9,
) -> Dict[str, Any]:
    """
    어제/그제 기준 리포트를 생성합니다.
    - date가 None이면 TZ 기준 어제를 '어제', 그 전날을 '그제'로 사용.
    - date가 'YYYY-MM-DD'로 들어오면:
      - 어제 := date
      - 그제 := date - 1일
    반환: 집계 리포트(JSON)
    """
    if date:
        y = dt.datetime.strptime(date, "%Y-%m-%d").date()
        d = y - dt.timedelta(days=1)
    else:
        y, d = _default_dates(reference_tz_offset_hours=tz_offset_hours)
    return build_report(y, d)


@mcp.tool
def sentry_mcp_analysis(report: Dict[str, Any]) -> str:
    """
    OpenAI GPT를 이용해 MCP 기반 분석 요약을 생성합니다.
    - 입력: sentry_daily_report 결과(JSON)
    - 출력: 마크다운 텍스트
    """
    if not openai_client:
        raise RuntimeError("OPENAI_API_KEY not configured. Cannot run analysis.")

    analysis_prompt = f"""
다음은 어제({report['date']}) 기준 Sentry 크래시 리포트 데이터입니다.

- 크래시 발생 수: {report['issue_count']}건 (전일 대비 Δ {report['issue_count_diff']})
- 영향받은 사용자 수: {report['affected_users']}명
- 크래시 이슈 수: {len(report['issue_type_counts'])}개
- Crash-Free Rate: {report['crash_rate']}

주요 체크포인트:
- 우선순위 높은 이슈 수: {report['high_priority_count']}
- 신규 발생 이슈 수: {report['new_issue_count']}
- 급증한 이슈 수: {report['spike_issue_count']}

위 데이터를 바탕으로,
1) 우선순위가 높은 이슈가 실제로 중요한지?
2) 신규 이슈 중 주목할만한 것이 있는지?
3) 급증 이슈가 서비스 운영에 위협이 될 가능성이 있는지?

요약 분석과 권장 대응 방향을 작성해줘.
"""
    completion = openai_client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "당신은 Sentry MCP 기반 리포트 분석 전문가입니다."},
            {"role": "user", "content": analysis_prompt},
        ],
    )
    return completion.choices[0].message.content or ""


@mcp.tool
def sentry_slack_payload(report: Dict[str, Any], analysis_md: str) -> Dict[str, Any]:
    """
    Slack Block Kit payload를 생성합니다.
    - 입력: report (sentry_daily_report), analysis_md (sentry_mcp_analysis 결과)
    - 출력: dict (Slack chat.postMessage용)
    """
    return {
        "blocks": [
            {
                "type": "header",
                "text": {"type": "plain_text", "text": f"Android 일간 크래시 리포트 [MCP] - {report['date']}"},
            },
            {
                "type": "section",
                "text": {"type": "mrkdwn", "text": f"*🔎 주요 분석 결과 (MCP 기반)*\n{analysis_md}"},
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": (
                        "*📊 기본 지표*\n\n"
                        f"- 크래시 발생: {report['issue_count']}건 (Δ {report['issue_count_diff']})\n"
                        f"- 크래시 이슈 수: {len(report['issue_type_counts'])}개\n"
                        f"- 영향받은 사용자: {report['affected_users']}명\n"
                        f"- Crash-Free Rate: {report['crash_rate']}"
                    ),
                },
            },
            {
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "Sentry 대시보드 열기"},
                        "url": report.get("dashboard_url"),
                    }
                ],
            },
        ]
    }


# (선택) 리소스 노출: 가장 최근 리포트를 리소스로 제공
@mcp.resource("sentry://daily-report")
def resource_daily_report(context: Context) -> str:
    """
    최근(어제/그제) 리포트를 리소스로 노출합니다.
    MCP 클라이언트에서 이 리소스를 읽어 사용할 수 있습니다.
    """
    y, d = _default_dates()
    report = build_report(y, d)
    return json.dumps(report, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    # STDIO 서버 시작
    # FastMCP는 기본적으로 stdin/stdout로 통신(클라이언트가 이 프로세스를 스폰)
    mcp.run()