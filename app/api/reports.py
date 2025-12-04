"""
Reports API 엔드포인트.

리포트 생성, 조회 API를 제공합니다.
"""

from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.services.analysis_client import analysis_client
from app.services.report_service import ReportService

router = APIRouter()


# ============================================================================
# Request/Response 모델
# ============================================================================

class ReportListItem(BaseModel):
    """리포트 목록 아이템 응답 모델."""
    id: int
    reportId: Optional[str] = None
    from_: Optional[str] = None  # 'from'은 예약어
    to: Optional[str] = None
    createdAt: Optional[str] = None
    title: Optional[str] = None
    status: Optional[str] = None

    class Config:
        # JSON 직렬화 시 from_ -> from으로 변환
        populate_by_name = True


class ReportListResponse(BaseModel):
    """리포트 목록 응답 모델."""
    items: List[ReportListItem]
    total: int


class CreateReportRequest(BaseModel):
    """리포트 생성 요청 모델."""
    from_date: str  # YYYY-MM-DD
    to_date: str  # YYYY-MM-DD
    releases: List[str]
    forceRefresh: bool = False

    class Config:
        # JSON에서 from -> from_date로 매핑
        populate_by_name = True


class CreateReportResponse(BaseModel):
    """리포트 생성 응답 모델."""
    id: int
    reportId: Optional[str] = None
    status: str
    error: Optional[str] = None


# ============================================================================
# 엔드포인트
# ============================================================================

@router.get("", response_model=ReportListResponse)
async def list_reports(
    limit: int = Query(default=20, ge=1, le=100, description="조회 개수"),
    offset: int = Query(default=0, ge=0, description="시작 위치"),
    status: Optional[str] = Query(default=None, description="상태 필터"),
    db: Session = Depends(get_db),
) -> ReportListResponse:
    """
    리포트 목록을 조회합니다.
    
    Query Parameters:
    - limit: 조회 개수 (기본값: 20, 최대: 100)
    - offset: 시작 위치 (기본값: 0)
    - status: 상태 필터 (queued, running, done, error)
    
    Returns:
        리포트 목록과 전체 개수
    """
    report_service = ReportService(db)
    reports, total = report_service.get_reports(
        limit=limit,
        offset=offset,
        status=status,
    )
    
    items = []
    for report in reports:
        items.append(ReportListItem(
            id=report.id,
            reportId=report.report_id,
            from_=report.from_date,
            to=report.to_date,
            createdAt=report.created_at.isoformat() if report.created_at else None,
            title=report.title,
            status=report.status,
        ))
    
    return ReportListResponse(items=items, total=total)


@router.post("", response_model=CreateReportResponse)
async def create_report(
    request: CreateReportRequest,
    db: Session = Depends(get_db),
) -> CreateReportResponse:
    """
    새 리포트를 생성합니다.
    
    Request Body:
    - from_date: 시작 날짜 (YYYY-MM-DD)
    - to_date: 종료 날짜 (YYYY-MM-DD)
    - releases: 대상 릴리즈 버전 목록
    - forceRefresh: 캐시 무시 여부 (기본값: false)
    
    처리 과정:
    1. reports 테이블에 row 생성 (status = "queued")
    2. 분석 서버에 POST /analysis/report 호출
    3. 분석 서버에서 받은 reportId 저장
    
    Returns:
        생성된 리포트 정보
    """
    report_service = ReportService(db)
    
    # 1. 리포트 생성
    report = report_service.create_report(
        from_date=request.from_date,
        to_date=request.to_date,
        releases=request.releases,
    )
    
    # 2. 분석 서버에 요청
    result = await analysis_client.request_report(
        from_date=request.from_date,
        to_date=request.to_date,
        releases=request.releases,
        force_refresh=request.forceRefresh,
    )
    
    # 3. 외부 reportId 저장
    if result.get("reportId"):
        report_service.update_report(report.id, {
            "report_id": result["reportId"],
            "status": result.get("status", "queued"),
        })
    elif result.get("error"):
        report_service.update_report(report.id, {
            "status": "error",
        })
    
    return CreateReportResponse(
        id=report.id,
        reportId=result.get("reportId"),
        status=result.get("status", "queued"),
        error=result.get("error"),
    )


@router.get("/{report_id}")
async def get_report(
    report_id: int,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    리포트 상세 정보를 조회합니다.
    
    Path Parameters:
    - report_id: 리포트 PK ID
    
    Returns:
        리포트 상세 정보
    """
    report_service = ReportService(db)
    detail = report_service.get_report_detail(report_id)
    
    if not detail:
        raise HTTPException(status_code=404, detail="Report not found")
    
    return detail


@router.post("/{report_id}/refresh")
async def refresh_report(
    report_id: int,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    리포트 상태를 분석 서버에서 다시 조회하여 업데이트합니다.
    
    Path Parameters:
    - report_id: 리포트 PK ID
    
    Returns:
        업데이트된 리포트 상태
    """
    report_service = ReportService(db)
    report = report_service.get_report_by_id(report_id)
    
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    
    if not report.report_id:
        raise HTTPException(status_code=400, detail="External report ID not available")
    
    # 분석 서버에서 상태 조회
    result = await analysis_client.get_report(report.report_id)
    
    # 결과 업데이트
    if result.get("status") != "error":
        report_service.update_report_from_analysis(report_id, result)
    
    return result
