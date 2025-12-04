"""
SQLAlchemy ORM 모델 정의.

issues, issue_analysis, reports, alert_logs 테이블을 정의합니다.
"""

from datetime import datetime
from typing import List

from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    ForeignKey,
    DateTime,
    Boolean,
)
from sqlalchemy.orm import relationship, Mapped

from app.db.session import Base


class Issue(Base):
    """
    Sentry 이슈 모델.
    
    Sentry에서 수신한 에러/이슈 정보를 저장합니다.
    """
    
    __tablename__ = "issues"
    
    id: int = Column(Integer, primary_key=True, autoincrement=True)
    sentry_issue_id: str = Column(String(255), unique=True, nullable=False, index=True)
    title: str = Column(Text, nullable=True)
    level: str = Column(String(50), nullable=True)  # error, warning, info, fatal
    first_seen_at: datetime = Column(DateTime, nullable=True)
    last_seen_at: datetime = Column(DateTime, nullable=True)
    event_count: int = Column(Integer, default=0)
    user_count: int = Column(Integer, default=0)
    release: str = Column(String(255), nullable=True)
    environment: str = Column(String(100), nullable=True)
    status: str = Column(String(50), default="unresolved")  # unresolved, resolved, ignored
    is_regression: bool = Column(Boolean, default=False)
    sentry_url: str = Column(Text, nullable=True)
    meta_json: str = Column(Text, nullable=True)  # 버전/OS/디바이스 분포 등 JSON
    
    # 관계 설정
    analyses: Mapped[List["IssueAnalysis"]] = relationship(
        "IssueAnalysis",
        back_populates="issue",
        cascade="all, delete-orphan",
    )
    alert_logs: Mapped[List["AlertLog"]] = relationship(
        "AlertLog",
        back_populates="issue",
        cascade="all, delete-orphan",
    )
    
    def __repr__(self) -> str:
        return f"<Issue(id={self.id}, sentry_issue_id={self.sentry_issue_id}, title={self.title[:30] if self.title else 'N/A'})>"


class IssueAnalysis(Base):
    """
    이슈 분석 결과 모델.
    
    AI 분석 서버에서 반환된 분석 결과를 저장합니다.
    """
    
    __tablename__ = "issue_analysis"
    
    id: int = Column(Integer, primary_key=True, autoincrement=True)
    issue_id: int = Column(Integer, ForeignKey("issues.id"), nullable=False, index=True)
    created_at: datetime = Column(DateTime, default=datetime.utcnow)
    priority_score: int = Column(Integer, nullable=True)
    root_cause: str = Column(Text, nullable=True)
    is_edge_case: bool = Column(Boolean, default=False)
    cause_type: str = Column(String(50), nullable=True)  # client, server, os, 3rdparty, obfuscation, unknown
    solution: str = Column(Text, nullable=True)
    additional_info: str = Column(Text, nullable=True)
    raw_response_json: str = Column(Text, nullable=True)  # 원본 응답 JSON
    
    # 관계 설정
    issue: Mapped["Issue"] = relationship("Issue", back_populates="analyses")
    
    def __repr__(self) -> str:
        return f"<IssueAnalysis(id={self.id}, issue_id={self.issue_id}, priority_score={self.priority_score})>"


class Report(Base):
    """
    분석 리포트 모델.
    
    기간별/버전별 크래시 리포트를 저장합니다.
    """
    
    __tablename__ = "reports"
    
    id: int = Column(Integer, primary_key=True, autoincrement=True)
    report_id: str = Column(String(255), unique=True, nullable=True, index=True)
    from_date: str = Column(String(20), nullable=True)  # YYYY-MM-DD
    to_date: str = Column(String(20), nullable=True)  # YYYY-MM-DD
    releases_json: str = Column(Text, nullable=True)  # JSON 배열 문자열
    created_at: datetime = Column(DateTime, default=datetime.utcnow)
    status: str = Column(String(50), default="queued")  # queued, running, done, error
    title: str = Column(Text, nullable=True)
    summary: str = Column(Text, nullable=True)
    resolved_issues: str = Column(Text, nullable=True)
    remaining_issues: str = Column(Text, nullable=True)
    recurring_issues: str = Column(Text, nullable=True)
    action_items: str = Column(Text, nullable=True)
    insights: str = Column(Text, nullable=True)
    
    def __repr__(self) -> str:
        return f"<Report(id={self.id}, report_id={self.report_id}, status={self.status})>"


class AlertLog(Base):
    """
    알림 로그 모델.
    
    Slack 등으로 전송된 알림 기록을 저장합니다.
    """
    
    __tablename__ = "alert_logs"
    
    id: int = Column(Integer, primary_key=True, autoincrement=True)
    issue_id: int = Column(Integer, ForeignKey("issues.id"), nullable=False, index=True)
    alerted_at: datetime = Column(DateTime, default=datetime.utcnow)
    alert_type: str = Column(String(50), nullable=True)  # slack, email, etc.
    slack_message_ts: str = Column(String(255), nullable=True)  # Slack 메시지 타임스탬프
    
    # 관계 설정
    issue: Mapped["Issue"] = relationship("Issue", back_populates="alert_logs")
    
    def __repr__(self) -> str:
        return f"<AlertLog(id={self.id}, issue_id={self.issue_id}, alert_type={self.alert_type})>"
