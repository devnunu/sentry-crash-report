"""
Sentry Webhook Payload 변환 모듈.

Sentry에서 수신한 Webhook payload를 Issue 모델로 변환합니다.
"""

import json
from datetime import datetime
from typing import Dict, Any, Optional


def parse_datetime(value: Optional[str]) -> Optional[datetime]:
    """
    다양한 날짜/시간 형식을 파싱합니다.
    
    Args:
        value: ISO 8601 형식의 날짜/시간 문자열
        
    Returns:
        datetime 객체 또는 None
    """
    if not value:
        return None
    
    try:
        # ISO 8601 형식 파싱 시도
        # 2025-01-01T10:00:00.000Z 또는 2025-01-01T10:00:00+00:00
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        try:
            # 다른 형식 시도
            return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S")
        except (ValueError, TypeError):
            return None


def extract_meta_info(event_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    이벤트 데이터에서 메타 정보를 추출합니다.
    
    Args:
        event_data: Sentry 이벤트 데이터
        
    Returns:
        버전/OS/디바이스 분포 등의 메타 정보
    """
    meta = {}
    
    # 컨텍스트 정보 추출
    contexts = event_data.get("contexts", {})
    
    # OS 정보
    os_info = contexts.get("os", {})
    if os_info:
        meta["os"] = {
            "name": os_info.get("name", "Unknown"),
            "version": os_info.get("version", "Unknown"),
        }
    
    # 디바이스 정보
    device_info = contexts.get("device", {})
    if device_info:
        meta["device"] = {
            "model": device_info.get("model", "Unknown"),
            "family": device_info.get("family", "Unknown"),
        }
    
    # 앱 정보
    app_info = contexts.get("app", {})
    if app_info:
        meta["app"] = {
            "version": app_info.get("app_version", "Unknown"),
            "build": app_info.get("app_build", "Unknown"),
        }
    
    # 태그 정보
    tags = event_data.get("tags", [])
    if isinstance(tags, list):
        meta["tags"] = {tag[0]: tag[1] for tag in tags if len(tag) >= 2}
    elif isinstance(tags, dict):
        meta["tags"] = tags
    
    return meta


def map_sentry_webhook_to_issue(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Sentry Webhook payload를 Issue 모델 데이터로 변환합니다.
    
    Sentry Webhook 형식:
    https://docs.sentry.io/product/integrations/integration-platform/webhooks/
    
    Args:
        payload: Sentry Webhook JSON payload
        
    Returns:
        Issue 모델에 매핑할 데이터 딕셔너리
    """
    # Webhook action 타입 확인
    action = payload.get("action", "created")
    
    # 이슈 데이터 추출
    issue_data = payload.get("data", {}).get("issue", payload.get("data", {}))
    event_data = payload.get("data", {}).get("event", {})
    
    # Sentry 이슈 ID
    sentry_issue_id = str(issue_data.get("id", ""))
    if not sentry_issue_id:
        # 이벤트에서 group_id 추출 시도
        sentry_issue_id = str(event_data.get("groupID", event_data.get("group_id", "")))
    
    # 제목 추출
    title = issue_data.get("title", "") or event_data.get("title", "")
    if not title:
        # 메시지에서 추출 시도
        title = event_data.get("message", "Unknown Error")
    
    # 레벨 추출
    level = issue_data.get("level", "") or event_data.get("level", "error")
    
    # 시간 정보
    first_seen_at = parse_datetime(
        issue_data.get("firstSeen") or issue_data.get("first_seen")
    )
    last_seen_at = parse_datetime(
        issue_data.get("lastSeen") or issue_data.get("last_seen")
    )
    
    # 통계 정보
    event_count = issue_data.get("count", 0)
    if isinstance(event_count, str):
        try:
            event_count = int(event_count)
        except ValueError:
            event_count = 0
    
    user_count = issue_data.get("userCount", issue_data.get("user_count", 0))
    if isinstance(user_count, str):
        try:
            user_count = int(user_count)
        except ValueError:
            user_count = 0
    
    # 릴리즈 정보
    release = event_data.get("release", "") or issue_data.get("culprit", "")
    if isinstance(release, dict):
        release = release.get("version", "")
    
    # 환경 정보
    environment = event_data.get("environment", "") or issue_data.get("project", {}).get("environment", "")
    
    # 상태 정보
    status = issue_data.get("status", "unresolved")
    
    # Regression 여부
    is_regression = issue_data.get("isRegression", False) or issue_data.get("is_regression", False)
    
    # Sentry URL 구성
    project = issue_data.get("project", {})
    if isinstance(project, dict):
        project_slug = project.get("slug", "")
    else:
        project_slug = ""
    
    sentry_url = issue_data.get("permalink", "")
    if not sentry_url and sentry_issue_id:
        # URL 구성 시도
        org_slug = payload.get("installation", {}).get("organization", {}).get("slug", "")
        if org_slug and project_slug:
            sentry_url = f"https://sentry.io/organizations/{org_slug}/issues/{sentry_issue_id}/"
    
    # 메타 정보 추출
    meta_info = extract_meta_info(event_data)
    
    return {
        "sentry_issue_id": sentry_issue_id,
        "title": title,
        "level": level,
        "first_seen_at": first_seen_at,
        "last_seen_at": last_seen_at,
        "event_count": event_count,
        "user_count": user_count,
        "release": release,
        "environment": environment,
        "status": status,
        "is_regression": is_regression,
        "sentry_url": sentry_url,
        "meta_json": json.dumps(meta_info, ensure_ascii=False) if meta_info else None,
    }


def extract_issue_id_from_url(url: str) -> Optional[str]:
    """
    Sentry URL에서 이슈 ID를 추출합니다.
    
    지원하는 URL 형식:
    - https://sentry.io/organizations/{org}/issues/{issue_id}/
    - https://{org}.sentry.io/issues/{issue_id}/
    
    Args:
        url: Sentry 이슈 URL
        
    Returns:
        이슈 ID 문자열 또는 None
    """
    import re
    
    # 패턴 1: https://sentry.io/organizations/{org}/issues/{issue_id}/
    pattern1 = r"sentry\.io/organizations/[^/]+/issues/(\d+)"
    match = re.search(pattern1, url)
    if match:
        return match.group(1)
    
    # 패턴 2: https://{org}.sentry.io/issues/{issue_id}/
    pattern2 = r"\.sentry\.io/issues/(\d+)"
    match = re.search(pattern2, url)
    if match:
        return match.group(1)
    
    # 패턴 3: 직접 숫자만 입력한 경우
    if url.isdigit():
        return url
    
    return None
