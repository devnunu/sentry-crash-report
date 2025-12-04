"""
FastAPI 애플리케이션 메인 엔트리포인트.

Sentry AI Assistant 서버를 초기화하고 실행합니다.
"""

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import issues, reports, webhook
from app.db.init_db import init_database
from config.settings import settings


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    애플리케이션 라이프사이클 관리.
    
    시작 시 데이터베이스를 초기화하고, 종료 시 정리 작업을 수행합니다.
    """
    # Startup: 데이터베이스 테이블 생성
    print("🚀 Starting Sentry AI Assistant...")
    init_database()
    print("✅ Database initialized")
    
    yield
    
    # Shutdown: 정리 작업
    print("👋 Shutting down Sentry AI Assistant...")


# FastAPI 애플리케이션 인스턴스
app = FastAPI(
    title="Sentry AI Assistant",
    description="Sentry 에러 이슈를 AI로 분석하고 리포트를 생성하는 내부 도구",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS 미들웨어 설정 (Streamlit UI에서 접근 허용)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 개발 환경용, 프로덕션에서는 제한 필요
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 라우터 등록
app.include_router(webhook.router, prefix="/webhook", tags=["Webhook"])
app.include_router(issues.router, prefix="/api/issues", tags=["Issues"])
app.include_router(reports.router, prefix="/api/reports", tags=["Reports"])


@app.get("/health", tags=["Health"])
async def health_check() -> dict:
    """
    헬스 체크 엔드포인트.
    
    서버 상태를 확인하고 기본 설정 정보를 반환합니다.
    """
    return {
        "status": "ok",
        "app_env": settings.app_env,
        "test_mode": settings.test_mode,
    }


if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.app_env == "development",
    )
