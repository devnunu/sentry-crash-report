"""
SQLite 데이터베이스 세션 및 엔진 관리 모듈.

SQLAlchemy를 사용하여 데이터베이스 연결을 관리합니다.
"""

from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session, declarative_base

from config.settings import settings

# SQLite 연결 문자열
# check_same_thread=False는 FastAPI의 비동기 환경에서 SQLite를 사용할 때 필요
DATABASE_URL = settings.database_url

if DATABASE_URL.startswith("sqlite"):
    # SQLite의 경우 check_same_thread=False 추가
    connect_args = {"check_same_thread": False}
else:
    connect_args = {}

# SQLAlchemy 엔진 생성
engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    echo=settings.app_env == "development",  # 개발 환경에서 SQL 로그 출력
)

# 세션 팩토리
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)

# ORM 모델 베이스 클래스
Base = declarative_base()


def get_db() -> Generator[Session, None, None]:
    """
    데이터베이스 세션을 생성하고 반환합니다.
    
    FastAPI의 Depends()와 함께 사용하여 요청마다 세션을 주입합니다.
    
    Yields:
        Session: SQLAlchemy 세션 인스턴스
    
    Example:
        @app.get("/items")
        def get_items(db: Session = Depends(get_db)):
            return db.query(Item).all()
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
