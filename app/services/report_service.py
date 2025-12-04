"""
Report 비즈니스 로직 서비스.

리포트 생성, 조회 및 업데이트 로직을 담당합니다.
"""

import json
from typing import Optional, List, Dict, Any

from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.db.models import Report


class ReportService:
    """리포트 관련 비즈니스 로직 서비스."""
    
    def __init__(self, db: Session):
        """
        서비스 초기화.
        
        Args:
            db: SQLAlchemy 세션
        """
        self.db = db
    
    def create_report(
        self,
        from_date: str,
        to_date: str,
        releases: List[str],
        report_id: Optional[str] = None,
    ) -> Report:
        """
        새 리포트를 생성합니다.
        
        Args:
            from_date: 시작 날짜 (YYYY-MM-DD)
            to_date: 종료 날짜 (YYYY-MM-DD)
            releases: 대상 릴리즈 버전 목록
            report_id: 외부 분석 서버에서 받은 리포트 ID (Optional)
            
        Returns:
            생성된 Report 인스턴스
        """
        # 제목 자동 생성
        title = f"{from_date} ~ {to_date} 앱 크래시 리포트"
        if releases:
            title += f" ({', '.join(releases[:3])}{'...' if len(releases) > 3 else ''})"
        
        report = Report(
            report_id=report_id,
            from_date=from_date,
            to_date=to_date,
            releases_json=json.dumps(releases, ensure_ascii=False),
            title=title,
            status="queued",
        )
        
        self.db.add(report)
        self.db.commit()
        self.db.refresh(report)
        
        return report
    
    def get_report_by_id(self, report_id: int) -> Optional[Report]:
        """
        ID로 리포트를 조회합니다.
        
        Args:
            report_id: 리포트 PK ID
            
        Returns:
            Report 인스턴스 또는 None
        """
        return self.db.query(Report).filter(Report.id == report_id).first()
    
    def get_report_by_external_id(self, external_report_id: str) -> Optional[Report]:
        """
        외부 리포트 ID로 리포트를 조회합니다.
        
        Args:
            external_report_id: 분석 서버에서 받은 리포트 ID
            
        Returns:
            Report 인스턴스 또는 None
        """
        return self.db.query(Report).filter(
            Report.report_id == external_report_id
        ).first()
    
    def get_reports(
        self,
        limit: int = 20,
        offset: int = 0,
        status: Optional[str] = None,
    ) -> tuple[List[Report], int]:
        """
        리포트 목록을 조회합니다.
        
        Args:
            limit: 조회 개수 제한
            offset: 시작 위치
            status: 상태 필터 (queued, running, done, error)
            
        Returns:
            (리포트 목록, 전체 개수) 튜플
        """
        query = self.db.query(Report)
        
        if status:
            query = query.filter(Report.status == status)
        
        total = query.count()
        reports = query.order_by(desc(Report.created_at)).offset(offset).limit(limit).all()
        
        return reports, total
    
    def update_report(
        self,
        report_id: int,
        update_data: Dict[str, Any],
    ) -> Optional[Report]:
        """
        리포트를 업데이트합니다.
        
        Args:
            report_id: 리포트 PK ID
            update_data: 업데이트할 데이터
            
        Returns:
            업데이트된 Report 인스턴스 또는 None
        """
        report = self.get_report_by_id(report_id)
        if not report:
            return None
        
        for key, value in update_data.items():
            if hasattr(report, key) and value is not None:
                setattr(report, key, value)
        
        self.db.commit()
        self.db.refresh(report)
        
        return report
    
    def update_report_from_analysis(
        self,
        report_id: int,
        analysis_result: Dict[str, Any],
    ) -> Optional[Report]:
        """
        분석 서버 결과로 리포트를 업데이트합니다.
        
        Args:
            report_id: 리포트 PK ID
            analysis_result: 분석 서버 응답 데이터
            
        Returns:
            업데이트된 Report 인스턴스 또는 None
        """
        update_data = {
            "status": analysis_result.get("status", "done"),
            "summary": analysis_result.get("summary"),
            "resolved_issues": analysis_result.get("resolvedIssues"),
            "remaining_issues": analysis_result.get("remainingIssues"),
            "recurring_issues": analysis_result.get("recurringIssues"),
            "action_items": analysis_result.get("actionItems"),
            "insights": analysis_result.get("insights"),
        }
        
        return self.update_report(report_id, update_data)
    
    def get_report_detail(self, report_id: int) -> Optional[Dict[str, Any]]:
        """
        리포트 상세 정보를 조회합니다.
        
        Args:
            report_id: 리포트 PK ID
            
        Returns:
            상세 정보 딕셔너리 또는 None
        """
        report = self.get_report_by_id(report_id)
        if not report:
            return None
        
        # releases 파싱
        releases = []
        if report.releases_json:
            try:
                releases = json.loads(report.releases_json)
            except json.JSONDecodeError:
                pass
        
        return {
            "id": report.id,
            "reportId": report.report_id,
            "from": report.from_date,
            "to": report.to_date,
            "releases": releases,
            "createdAt": report.created_at.isoformat() if report.created_at else None,
            "status": report.status,
            "title": report.title,
            "summary": report.summary,
            "resolvedIssues": report.resolved_issues,
            "remainingIssues": report.remaining_issues,
            "recurringIssues": report.recurring_issues,
            "actionItems": report.action_items,
            "insights": report.insights,
        }
