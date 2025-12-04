"""
Issue 비즈니스 로직 서비스.

이슈 생성, 조회, 업데이트 및 중요도 판단 로직을 담당합니다.
"""

import json
from typing import Optional, List, Dict, Any

from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.db.models import Issue, IssueAnalysis
from config.settings import settings


class IssueService:
    """이슈 관련 비즈니스 로직 서비스."""
    
    def __init__(self, db: Session):
        """
        서비스 초기화.
        
        Args:
            db: SQLAlchemy 세션
        """
        self.db = db
    
    def upsert_issue(self, issue_data: Dict[str, Any]) -> Issue:
        """
        이슈를 생성하거나 업데이트합니다.
        
        sentry_issue_id를 기준으로 기존 이슈가 있으면 업데이트,
        없으면 새로 생성합니다.
        
        Args:
            issue_data: 이슈 데이터 딕셔너리
            
        Returns:
            생성/업데이트된 Issue 인스턴스
        """
        sentry_issue_id = issue_data.get("sentry_issue_id")
        
        if not sentry_issue_id:
            raise ValueError("sentry_issue_id is required")
        
        # 기존 이슈 조회
        existing_issue = self.db.query(Issue).filter(
            Issue.sentry_issue_id == sentry_issue_id
        ).first()
        
        if existing_issue:
            # 업데이트
            for key, value in issue_data.items():
                if value is not None and hasattr(existing_issue, key):
                    setattr(existing_issue, key, value)
            self.db.commit()
            self.db.refresh(existing_issue)
            return existing_issue
        else:
            # 새로 생성
            new_issue = Issue(**issue_data)
            self.db.add(new_issue)
            self.db.commit()
            self.db.refresh(new_issue)
            return new_issue
    
    def get_issue_by_id(self, issue_id: int) -> Optional[Issue]:
        """
        ID로 이슈를 조회합니다.
        
        Args:
            issue_id: 이슈 PK ID
            
        Returns:
            Issue 인스턴스 또는 None
        """
        return self.db.query(Issue).filter(Issue.id == issue_id).first()
    
    def get_issue_by_sentry_id(self, sentry_issue_id: str) -> Optional[Issue]:
        """
        Sentry 이슈 ID로 이슈를 조회합니다.
        
        Args:
            sentry_issue_id: Sentry 이슈 ID
            
        Returns:
            Issue 인스턴스 또는 None
        """
        return self.db.query(Issue).filter(
            Issue.sentry_issue_id == sentry_issue_id
        ).first()
    
    def get_issues(
        self,
        limit: int = 20,
        offset: int = 0,
        level: Optional[str] = None,
        status: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
    ) -> tuple[List[Issue], int]:
        """
        이슈 목록을 조회합니다.
        
        Args:
            limit: 조회 개수 제한
            offset: 시작 위치
            level: 레벨 필터 (error, warning, etc.)
            status: 상태 필터 (unresolved, resolved, ignored)
            from_date: 시작 날짜 필터 (YYYY-MM-DD)
            to_date: 종료 날짜 필터 (YYYY-MM-DD)
            
        Returns:
            (이슈 목록, 전체 개수) 튜플
        """
        query = self.db.query(Issue)
        
        # 필터 적용
        if level:
            query = query.filter(Issue.level == level)
        if status:
            query = query.filter(Issue.status == status)
        if from_date:
            query = query.filter(Issue.last_seen_at >= from_date)
        if to_date:
            query = query.filter(Issue.last_seen_at <= to_date)
        
        # 전체 개수
        total = query.count()
        
        # 정렬 및 페이징
        issues = query.order_by(desc(Issue.last_seen_at)).offset(offset).limit(limit).all()
        
        return issues, total
    
    def get_latest_analysis(self, issue_id: int) -> Optional[IssueAnalysis]:
        """
        이슈의 최신 분석 결과를 조회합니다.
        
        Args:
            issue_id: 이슈 PK ID
            
        Returns:
            IssueAnalysis 인스턴스 또는 None
        """
        return self.db.query(IssueAnalysis).filter(
            IssueAnalysis.issue_id == issue_id
        ).order_by(desc(IssueAnalysis.created_at)).first()
    
    def save_analysis(
        self,
        issue_id: int,
        analysis_data: Dict[str, Any],
    ) -> IssueAnalysis:
        """
        분석 결과를 저장합니다.
        
        Args:
            issue_id: 이슈 PK ID
            analysis_data: 분석 결과 데이터
            
        Returns:
            생성된 IssueAnalysis 인스턴스
        """
        analysis = IssueAnalysis(
            issue_id=issue_id,
            priority_score=analysis_data.get("priorityScore"),
            root_cause=analysis_data.get("rootCause"),
            is_edge_case=analysis_data.get("isEdgeCase", False),
            cause_type=analysis_data.get("causeType"),
            solution=analysis_data.get("solution"),
            additional_info=analysis_data.get("additionalInfo"),
            raw_response_json=json.dumps(analysis_data, ensure_ascii=False),
        )
        
        self.db.add(analysis)
        self.db.commit()
        self.db.refresh(analysis)
        
        return analysis
    
    def is_important_issue(self, issue: Issue) -> bool:
        """
        이슈가 중요한지 판단합니다.
        
        판단 기준:
        - level이 error 또는 fatal
        - event_count가 임계값 이상
        - user_count가 임계값 이상
        - regression인 경우
        
        Args:
            issue: Issue 인스턴스
            
        Returns:
            중요 여부
        """
        # 레벨 기준
        if issue.level in ("fatal", "error"):
            # 이벤트 수 또는 유저 수 기준
            if (issue.event_count >= settings.important_event_count_threshold or
                issue.user_count >= settings.important_user_count_threshold):
                return True
            
            # Regression인 경우
            if issue.is_regression:
                return True
        
        return False
    
    def get_issue_detail(self, issue_id: int) -> Optional[Dict[str, Any]]:
        """
        이슈 상세 정보를 조회합니다.
        
        이슈 기본 정보와 최신 분석 결과, 메타 정보를 함께 반환합니다.
        
        Args:
            issue_id: 이슈 PK ID
            
        Returns:
            상세 정보 딕셔너리 또는 None
        """
        issue = self.get_issue_by_id(issue_id)
        if not issue:
            return None
        
        analysis = self.get_latest_analysis(issue_id)
        
        # 메타 정보 파싱
        meta = {}
        if issue.meta_json:
            try:
                meta = json.loads(issue.meta_json)
            except json.JSONDecodeError:
                pass
        
        result = {
            "id": issue.id,
            "sentryIssueId": issue.sentry_issue_id,
            "title": issue.title,
            "level": issue.level,
            "eventCount": issue.event_count,
            "userCount": issue.user_count,
            "firstSeenAt": issue.first_seen_at.isoformat() if issue.first_seen_at else None,
            "lastSeenAt": issue.last_seen_at.isoformat() if issue.last_seen_at else None,
            "release": issue.release,
            "environment": issue.environment,
            "status": issue.status,
            "isRegression": issue.is_regression,
            "sentryUrl": issue.sentry_url,
            "versions": meta.get("tags", {}).get("release", {}),
            "osVersions": meta.get("os", {}),
            "devices": meta.get("device", {}),
        }
        
        if analysis:
            result["analysis"] = {
                "priorityScore": analysis.priority_score,
                "rootCause": analysis.root_cause,
                "isEdgeCase": analysis.is_edge_case,
                "causeType": analysis.cause_type,
                "solution": analysis.solution,
                "additionalInfo": analysis.additional_info,
            }
        else:
            result["analysis"] = None
        
        return result
