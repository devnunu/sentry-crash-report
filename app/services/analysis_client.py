"""
외부 AI 분석 서버 HTTP 클라이언트.

분석 서버와의 모든 HTTP 통신을 담당합니다.
"""

from typing import Optional, Dict, Any, List

import httpx

from config.settings import settings


class AnalysisClient:
    """
    분석 서버 API 클라이언트.
    
    ANALYSIS_SERVER_BASE_URL로 설정된 외부 서버와 통신합니다.
    """
    
    def __init__(self, base_url: Optional[str] = None, timeout: float = 30.0):
        """
        클라이언트 초기화.
        
        Args:
            base_url: 분석 서버 기본 URL (기본값: settings에서 로드)
            timeout: HTTP 요청 타임아웃 (초)
        """
        self.base_url = base_url or settings.analysis_server_base_url
        self.timeout = timeout
    
    async def request_issue_analysis(
        self,
        issue_id: str,
        force_refresh: bool = False,
    ) -> Dict[str, Any]:
        """
        이슈 분석을 요청합니다.
        
        POST /analysis/issue
        
        Args:
            issue_id: Sentry 이슈 ID
            force_refresh: 캐시된 결과를 무시하고 새로 분석할지 여부
            
        Returns:
            {
                "jobId": "job-123",
                "status": "queued" | "reused"
            }
        """
        url = f"{self.base_url}/analysis/issue"
        payload = {
            "issueId": issue_id,
            "forceRefresh": force_refresh,
        }
        
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                response = await client.post(url, json=payload)
                response.raise_for_status()
                return response.json()
            except httpx.HTTPError as e:
                print(f"❌ Failed to request issue analysis: {e}")
                return {"error": str(e), "status": "error"}
    
    async def get_issue_analysis(self, issue_id: str) -> Dict[str, Any]:
        """
        이슈 분석 결과를 조회합니다.
        
        GET /analysis/issue/{issueId}
        
        Args:
            issue_id: Sentry 이슈 ID
            
        Returns:
            {
                "issueId": "12345",
                "status": "done" | "queued" | "running" | "error",
                "analysis": {
                    "priorityScore": 87,
                    "rootCause": "...",
                    "isEdgeCase": false,
                    "causeType": "client",
                    "solution": "...",
                    "additionalInfo": "..."
                }
            }
        """
        url = f"{self.base_url}/analysis/issue/{issue_id}"
        
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                response = await client.get(url)
                response.raise_for_status()
                return response.json()
            except httpx.HTTPError as e:
                print(f"❌ Failed to get issue analysis: {e}")
                return {"issueId": issue_id, "status": "error", "error": str(e)}
    
    async def request_report(
        self,
        from_date: str,
        to_date: str,
        releases: List[str],
        force_refresh: bool = False,
    ) -> Dict[str, Any]:
        """
        리포트 생성을 요청합니다.
        
        POST /analysis/report
        
        Args:
            from_date: 시작 날짜 (YYYY-MM-DD)
            to_date: 종료 날짜 (YYYY-MM-DD)
            releases: 대상 릴리즈 버전 목록
            force_refresh: 캐시된 결과를 무시하고 새로 생성할지 여부
            
        Returns:
            {
                "reportId": "report-111",
                "jobId": "job-report-111",
                "status": "queued"
            }
        """
        url = f"{self.base_url}/analysis/report"
        payload = {
            "from": from_date,
            "to": to_date,
            "releases": releases,
            "forceRefresh": force_refresh,
        }
        
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                response = await client.post(url, json=payload)
                response.raise_for_status()
                return response.json()
            except httpx.HTTPError as e:
                print(f"❌ Failed to request report: {e}")
                return {"error": str(e), "status": "error"}
    
    async def get_report(self, report_id: str) -> Dict[str, Any]:
        """
        리포트 결과를 조회합니다.
        
        GET /analysis/report/{reportId}
        
        Args:
            report_id: 리포트 ID
            
        Returns:
            {
                "reportId": "report-111",
                "status": "done" | "queued" | "running" | "error",
                "summary": "...",
                "resolvedIssues": "...",
                "remainingIssues": "...",
                "recurringIssues": "...",
                "actionItems": "...",
                "insights": "..."
            }
        """
        url = f"{self.base_url}/analysis/report/{report_id}"
        
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                response = await client.get(url)
                response.raise_for_status()
                return response.json()
            except httpx.HTTPError as e:
                print(f"❌ Failed to get report: {e}")
                return {"reportId": report_id, "status": "error", "error": str(e)}


# 전역 클라이언트 인스턴스
analysis_client = AnalysisClient()
