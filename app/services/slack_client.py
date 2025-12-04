"""
Slack Webhook 클라이언트.

Slack으로 알림 메시지를 전송합니다.
"""

from typing import Optional, Dict, Any

import httpx

from config.settings import settings


class SlackClient:
    """
    Slack Incoming Webhook 클라이언트.
    
    SLACK_WEBHOOK_URL로 설정된 웹훅으로 메시지를 전송합니다.
    """
    
    def __init__(self, webhook_url: Optional[str] = None, timeout: float = 10.0):
        """
        클라이언트 초기화.
        
        Args:
            webhook_url: Slack Webhook URL (기본값: settings에서 로드)
            timeout: HTTP 요청 타임아웃 (초)
        """
        self.webhook_url = webhook_url or settings.slack_webhook_url
        self.timeout = timeout
    
    def _format_issue_message(
        self,
        issue: Dict[str, Any],
        analysis: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        이슈 알림 메시지를 포맷팅합니다.
        
        Args:
            issue: 이슈 정보 딕셔너리
            analysis: 분석 결과 딕셔너리 (Optional)
            
        Returns:
            포맷팅된 메시지 문자열
        """
        # 기본 이슈 정보
        title = issue.get("title", "Unknown Issue")
        level = issue.get("level", "unknown").upper()
        event_count = issue.get("event_count", 0)
        user_count = issue.get("user_count", 0)
        sentry_url = issue.get("sentry_url", "")
        release = issue.get("release", "N/A")
        
        # 레벨에 따른 이모지
        level_emoji = {
            "FATAL": "🔴",
            "ERROR": "🟠",
            "WARNING": "🟡",
            "INFO": "🔵",
        }.get(level, "⚪")
        
        message_lines = [
            f"{level_emoji} *[{level}] Sentry 이슈 발생*",
            f"",
            f"*제목:* {title}",
            f"*릴리즈:* {release}",
            f"*이벤트 수:* {event_count}",
            f"*영향 유저 수:* {user_count}",
        ]
        
        # Sentry URL 추가
        if sentry_url:
            message_lines.append(f"*Sentry 링크:* {sentry_url}")
        
        # 분석 결과 추가
        if analysis:
            priority_score = analysis.get("priorityScore", analysis.get("priority_score", "N/A"))
            cause_type = analysis.get("causeType", analysis.get("cause_type", "unknown"))
            root_cause = analysis.get("rootCause", analysis.get("root_cause", ""))
            solution = analysis.get("solution", "")
            
            message_lines.extend([
                f"",
                f"📊 *AI 분석 결과*",
                f"*우선순위 점수:* {priority_score}/100",
                f"*원인 유형:* {cause_type}",
            ])
            
            if root_cause:
                # 너무 긴 경우 잘라서 표시
                root_cause_preview = root_cause[:200] + "..." if len(root_cause) > 200 else root_cause
                message_lines.append(f"*근본 원인:* {root_cause_preview}")
            
            if solution:
                solution_preview = solution[:200] + "..." if len(solution) > 200 else solution
                message_lines.append(f"*해결 방안:* {solution_preview}")
        
        return "\n".join(message_lines)
    
    async def send_message(self, text: str) -> bool:
        """
        일반 텍스트 메시지를 Slack으로 전송합니다.
        
        Args:
            text: 전송할 메시지 텍스트
            
        Returns:
            전송 성공 여부
        """
        if not self.webhook_url:
            print("⚠️ SLACK_WEBHOOK_URL is not configured")
            return False
        
        payload = {"text": text}
        
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                response = await client.post(self.webhook_url, json=payload)
                response.raise_for_status()
                print(f"✅ Slack message sent successfully")
                return True
            except httpx.HTTPError as e:
                print(f"❌ Failed to send Slack message: {e}")
                return False
    
    async def send_issue_alert(
        self,
        issue: Dict[str, Any],
        analysis: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """
        이슈 알림을 Slack으로 전송합니다.
        
        Args:
            issue: 이슈 정보 딕셔너리
            analysis: 분석 결과 딕셔너리 (Optional)
            
        Returns:
            전송 성공 여부
        """
        message = self._format_issue_message(issue, analysis)
        return await self.send_message(message)


# 전역 클라이언트 인스턴스
slack_client = SlackClient()
