"""
Sentry Webhook 엔드포인트.

Sentry에서 발생하는 이벤트를 수신하고 처리합니다.
"""

from typing import Dict, Any

from fastapi import APIRouter, Depends, BackgroundTasks, Request
from sqlalchemy.orm import Session

from app.db.models import AlertLog
from app.db.session import get_db
from app.services.analysis_client import analysis_client
from app.services.issue_service import IssueService
from app.services.sentry_mapper import map_sentry_webhook_to_issue
from app.services.slack_client import slack_client

router = APIRouter()


async def process_important_issue(
    issue_id: int,
    sentry_issue_id: str,
    issue_dict: Dict[str, Any],
    db: Session,
) -> None:
    """
    중요 이슈에 대한 후처리를 수행합니다.
    
    백그라운드에서 실행되며:
    1. Slack 알림 전송
    2. 분석 서버에 분석 요청
    3. 알림 로그 저장
    
    Args:
        issue_id: 이슈 PK ID
        sentry_issue_id: Sentry 이슈 ID
        issue_dict: 이슈 데이터 딕셔너리
        db: SQLAlchemy 세션
    """
    try:
        # 1. Slack 알림 전송
        await slack_client.send_issue_alert(issue_dict)
        
        # 알림 로그 저장
        alert_log = AlertLog(
            issue_id=issue_id,
            alert_type="slack",
        )
        db.add(alert_log)
        db.commit()
        
        # 2. 분석 서버에 분석 요청
        result = await analysis_client.request_issue_analysis(sentry_issue_id)
        print(f"📊 Analysis requested for issue {sentry_issue_id}: {result}")
        
    except Exception as e:
        print(f"❌ Error processing important issue: {e}")


@router.post("/sentry")
async def receive_sentry_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    Sentry Webhook을 수신합니다.
    
    Sentry에서 에러/이슈가 발생하면 이 엔드포인트로 payload가 전송됩니다.
    
    처리 과정:
    1. Webhook payload를 파싱하여 Issue 데이터로 변환
    2. issues 테이블에 upsert
    3. 중요도 판단 (level, event_count, user_count 기준)
    4. 중요한 경우: Slack 알림 + 분석 서버 트리거 (백그라운드)
    
    Returns:
        처리 결과 딕셔너리
    """
    # Webhook payload 파싱
    try:
        payload = await request.json()
    except Exception as e:
        print(f"❌ Failed to parse webhook payload: {e}")
        return {"status": "error", "message": "Invalid JSON payload"}
    
    # Webhook 타입 확인
    action = payload.get("action", "")

    print(f"📥 Received Sentry webhook: action={action}")

    # 이벤트 타입 검증 (issue 관련 action만 처리)
    # Sentry Internal Integration actions: created, resolved, unresolved, assigned, ignored
    valid_actions = ("created", "resolved", "unresolved", "assigned", "ignored")
    if action not in valid_actions:
        return {
            "status": "skipped",
            "message": f"Action '{action}' is not handled",
        }
    
    # Issue 데이터로 변환
    issue_data = map_sentry_webhook_to_issue(payload)
    
    if not issue_data.get("sentry_issue_id"):
        return {
            "status": "error",
            "message": "Could not extract issue ID from payload",
        }
    
    # Issue upsert
    issue_service = IssueService(db)
    issue = issue_service.upsert_issue(issue_data)
    
    print(f"✅ Issue upserted: id={issue.id}, sentry_id={issue.sentry_issue_id}")
    
    # 중요도 판단
    is_important = issue_service.is_important_issue(issue)
    
    if is_important:
        print(f"🚨 Important issue detected: {issue.title}")
        
        # 백그라운드에서 Slack 알림 및 분석 요청 처리
        background_tasks.add_task(
            process_important_issue,
            issue.id,
            issue.sentry_issue_id,
            issue_data,
            db,
        )
        
        return {
            "status": "accepted",
            "message": "Important issue detected, processing triggered",
            "issueId": issue.id,
            "sentryIssueId": issue.sentry_issue_id,
            "isImportant": True,
        }
    
    return {
        "status": "ok",
        "message": "Issue recorded",
        "issueId": issue.id,
        "sentryIssueId": issue.sentry_issue_id,
        "isImportant": False,
    }
