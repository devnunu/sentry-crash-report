"""
Issues API 엔드포인트.

이슈 조회 및 분석 트리거 API를 제공합니다.
"""

from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.services.analysis_client import analysis_client
from app.services.issue_service import IssueService

router = APIRouter()


# ============================================================================
# Request/Response 모델
# ============================================================================

class IssueListItem(BaseModel):
    """이슈 목록 아이템 응답 모델."""
    id: int
    sentryIssueId: str
    title: Optional[str] = None
    level: Optional[str] = None
    eventCount: int = 0
    userCount: int = 0
    lastSeenAt: Optional[str] = None
    priorityScore: Optional[int] = None
    status: Optional[str] = None


class IssueListResponse(BaseModel):
    """이슈 목록 응답 모델."""
    items: List[IssueListItem]
    total: int


class TriggerAnalysisResponse(BaseModel):
    """분석 트리거 응답 모델."""
    jobId: Optional[str] = None
    status: str
    error: Optional[str] = None


class ManualIssueRequest(BaseModel):
    """수동 이슈 분석 요청 모델."""
    issueIdOrUrl: str
    forceRefresh: bool = False


# ============================================================================
# 엔드포인트
# ============================================================================

@router.get("", response_model=IssueListResponse)
async def list_issues(
    limit: int = Query(default=20, ge=1, le=100, description="조회 개수"),
    offset: int = Query(default=0, ge=0, description="시작 위치"),
    level: Optional[str] = Query(default=None, description="레벨 필터"),
    status: Optional[str] = Query(default=None, description="상태 필터"),
    from_date: Optional[str] = Query(default=None, alias="from", description="시작 날짜"),
    to_date: Optional[str] = Query(default=None, alias="to", description="종료 날짜"),
    db: Session = Depends(get_db),
) -> IssueListResponse:
    """
    이슈 목록을 조회합니다.
    
    Query Parameters:
    - limit: 조회 개수 (기본값: 20, 최대: 100)
    - offset: 시작 위치 (기본값: 0)
    - level: 레벨 필터 (error, warning, info, fatal)
    - status: 상태 필터 (unresolved, resolved, ignored)
    - from: 시작 날짜 (YYYY-MM-DD)
    - to: 종료 날짜 (YYYY-MM-DD)
    
    Returns:
        이슈 목록과 전체 개수
    """
    issue_service = IssueService(db)
    issues, total = issue_service.get_issues(
        limit=limit,
        offset=offset,
        level=level,
        status=status,
        from_date=from_date,
        to_date=to_date,
    )
    
    items = []
    for issue in issues:
        # 최신 분석 결과 조회
        analysis = issue_service.get_latest_analysis(issue.id)
        priority_score = analysis.priority_score if analysis else None
        
        items.append(IssueListItem(
            id=issue.id,
            sentryIssueId=issue.sentry_issue_id,
            title=issue.title,
            level=issue.level,
            eventCount=issue.event_count or 0,
            userCount=issue.user_count or 0,
            lastSeenAt=issue.last_seen_at.isoformat() if issue.last_seen_at else None,
            priorityScore=priority_score,
            status=issue.status,
        ))
    
    return IssueListResponse(items=items, total=total)


@router.get("/{issue_id}")
async def get_issue(
    issue_id: int,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    이슈 상세 정보를 조회합니다.
    
    Path Parameters:
    - issue_id: 이슈 PK ID
    
    Returns:
        이슈 상세 정보 및 최신 분석 결과
    """
    issue_service = IssueService(db)
    detail = issue_service.get_issue_detail(issue_id)
    
    if not detail:
        raise HTTPException(status_code=404, detail="Issue not found")
    
    return detail


@router.post("/{issue_id}/trigger-analysis", response_model=TriggerAnalysisResponse)
async def trigger_analysis(
    issue_id: int,
    db: Session = Depends(get_db),
) -> TriggerAnalysisResponse:
    """
    이슈에 대한 AI 분석을 트리거합니다.
    
    Path Parameters:
    - issue_id: 이슈 PK ID
    
    Returns:
        분석 요청 결과 (jobId, status)
    """
    issue_service = IssueService(db)
    issue = issue_service.get_issue_by_id(issue_id)
    
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    
    # 분석 서버에 요청
    result = await analysis_client.request_issue_analysis(
        issue_id=issue.sentry_issue_id,
        force_refresh=True,  # 수동 트리거 시 항상 새로 분석
    )
    
    return TriggerAnalysisResponse(
        jobId=result.get("jobId"),
        status=result.get("status", "error"),
        error=result.get("error"),
    )


@router.post("/manual-analysis", response_model=TriggerAnalysisResponse)
async def manual_analysis(
    request: ManualIssueRequest,
    db: Session = Depends(get_db),
) -> TriggerAnalysisResponse:
    """
    수동으로 이슈 분석을 요청합니다.
    
    issueId 또는 Sentry URL을 입력받아 분석을 요청합니다.
    DB에 없는 이슈의 경우 임시로 row를 생성합니다.
    
    Request Body:
    - issueIdOrUrl: Sentry 이슈 ID 또는 URL
    - forceRefresh: 캐시 무시 여부 (기본값: false)
    
    Returns:
        분석 요청 결과 (jobId, status)
    """
    from app.services.sentry_mapper import extract_issue_id_from_url
    
    # issueId 추출
    input_value = request.issueIdOrUrl.strip()
    
    if input_value.startswith("http"):
        # URL에서 추출
        sentry_issue_id = extract_issue_id_from_url(input_value)
    else:
        sentry_issue_id = input_value
    
    if not sentry_issue_id:
        return TriggerAnalysisResponse(
            status="error",
            error="Could not extract issue ID from input",
        )
    
    issue_service = IssueService(db)
    
    # 기존 이슈 조회
    issue = issue_service.get_issue_by_sentry_id(sentry_issue_id)
    
    if not issue:
        # 임시 이슈 생성
        issue = issue_service.upsert_issue({
            "sentry_issue_id": sentry_issue_id,
            "title": f"Manual analysis request: {sentry_issue_id}",
            "status": "unresolved",
            "level": "unknown",
        })
        print(f"📝 Created temporary issue for manual analysis: {sentry_issue_id}")
    
    # 분석 서버에 요청
    result = await analysis_client.request_issue_analysis(
        issue_id=sentry_issue_id,
        force_refresh=request.forceRefresh,
    )
    
    return TriggerAnalysisResponse(
        jobId=result.get("jobId"),
        status=result.get("status", "error"),
        error=result.get("error"),
    )


@router.get("/{issue_id}/analysis-status")
async def get_analysis_status(
    issue_id: int,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    이슈의 분석 상태를 조회합니다.
    
    분석 서버에서 현재 분석 상태와 결과를 가져옵니다.
    분석이 완료된 경우 결과를 DB에 저장합니다.
    
    Path Parameters:
    - issue_id: 이슈 PK ID
    
    Returns:
        분석 상태 및 결과
    """
    issue_service = IssueService(db)
    issue = issue_service.get_issue_by_id(issue_id)
    
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    
    # 분석 서버에서 상태 조회
    result = await analysis_client.get_issue_analysis(issue.sentry_issue_id)
    
    # 분석 완료 시 결과 저장
    if result.get("status") == "done" and result.get("analysis"):
        issue_service.save_analysis(issue.id, result["analysis"])
    
    return result
