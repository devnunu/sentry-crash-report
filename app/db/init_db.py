"""
데이터베이스 초기화 스크립트.

테이블을 생성하고 초기 데이터를 설정합니다.
"""

from app.db.session import engine, Base


def init_database() -> None:
    """
    데이터베이스 테이블을 생성합니다.
    
    이미 존재하는 테이블은 건너뜁니다.
    """
    print("📦 Creating database tables...")
    Base.metadata.create_all(bind=engine)
    print("✅ Database tables created successfully")


def drop_all_tables() -> None:
    """
    모든 테이블을 삭제합니다.
    
    주의: 개발/테스트 환경에서만 사용하세요!
    """
    print("⚠️ Dropping all database tables...")
    Base.metadata.drop_all(bind=engine)
    print("✅ All tables dropped")


def reset_database() -> None:
    """
    데이터베이스를 초기화합니다 (테이블 삭제 후 재생성).
    
    주의: 개발/테스트 환경에서만 사용하세요!
    """
    drop_all_tables()
    init_database()


if __name__ == "__main__":
    # 스크립트로 직접 실행 시 테이블 생성
    init_database()
