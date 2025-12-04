"""
Sentry AI Assistant - Streamlit UI

FastAPI 서버와 연동하여 이슈 및 리포트를 관리하는 대시보드입니다.
"""

from datetime import date, timedelta
from typing import Dict, Optional

import requests
import streamlit as st

# ============================================================================
# 설정
# ============================================================================

# FastAPI 서버 URL (환경변수로 변경 가능)
API_BASE_URL = "http://localhost:8000"

# 페이지 설정
st.set_page_config(
    page_title="Sentry AI Assistant",
    page_icon="🐛",
    layout="wide",
    initial_sidebar_state="expanded",
)


# ============================================================================
# API 클라이언트 헬퍼
# ============================================================================

def api_get(endpoint: str, params: Optional[Dict] = None) -> Optional[Dict]:
    """GET 요청을 수행합니다."""
    try:
        response = requests.get(
            f"{API_BASE_URL}{endpoint}",
            params=params,
            timeout=10,
        )
        response.raise_for_status()
        return response.json()
    except requests.RequestException as e:
        st.error(f"API 요청 실패: {e}")
        return None


def api_post(endpoint: str, data: Optional[Dict] = None) -> Optional[Dict]:
    """POST 요청을 수행합니다."""
    try:
        response = requests.post(
            f"{API_BASE_URL}{endpoint}",
            json=data,
            timeout=30,
        )
        response.raise_for_status()
        return response.json()
    except requests.RequestException as e:
        st.error(f"API 요청 실패: {e}")
        return None


# ============================================================================
# 페이지: 이슈 리스트
# ============================================================================

def page_issues_list():
    """이슈 목록 페이지"""
    st.header("📋 이슈 목록")
    
    # 필터 옵션
    col1, col2, col3, col4 = st.columns(4)
    
    with col1:
        level_filter = st.selectbox(
            "레벨",
            options=["전체", "fatal", "error", "warning", "info"],
            key="issue_level_filter",
        )
    
    with col2:
        status_filter = st.selectbox(
            "상태",
            options=["전체", "unresolved", "resolved", "ignored"],
            key="issue_status_filter",
        )
    
    with col3:
        limit = st.number_input("표시 개수", min_value=5, max_value=100, value=20)
    
    with col4:
        offset = st.number_input("시작 위치", min_value=0, value=0, step=int(limit))
    
    # API 호출
    params = {
        "limit": limit,
        "offset": offset,
    }
    if level_filter != "전체":
        params["level"] = level_filter
    if status_filter != "전체":
        params["status"] = status_filter
    
    result = api_get("/api/issues", params)
    
    if result:
        st.markdown(f"**전체 {result['total']}개 이슈 중 {len(result['items'])}개 표시**")
        
        if result["items"]:
            # 테이블 형태로 표시
            for issue in result["items"]:
                with st.container():
                    col1, col2, col3, col4, col5, col6 = st.columns([1, 4, 1, 1, 1, 1])
                    
                    with col1:
                        # 레벨에 따른 색상 배지
                        level = issue.get("level", "unknown")
                        level_colors = {
                            "fatal": "🔴",
                            "error": "🟠",
                            "warning": "🟡",
                            "info": "🔵",
                        }
                        st.write(f"{level_colors.get(level, '⚪')} {level}")
                    
                    with col2:
                        # 제목 (클릭 시 상세 페이지로)
                        title = issue.get("title", "Unknown")[:60]
                        if len(issue.get("title", "")) > 60:
                            title += "..."
                        if st.button(
                            title,
                            key=f"issue_{issue['id']}",
                            help="클릭하여 상세 보기",
                        ):
                            st.session_state["selected_issue_id"] = issue["id"]
                            st.session_state["page"] = "issue_detail"
                            st.rerun()
                    
                    with col3:
                        st.write(f"📊 {issue.get('eventCount', 0)}")
                    
                    with col4:
                        st.write(f"👥 {issue.get('userCount', 0)}")
                    
                    with col5:
                        priority = issue.get("priorityScore")
                        if priority:
                            st.write(f"⚡ {priority}")
                        else:
                            st.write("⚡ -")
                    
                    with col6:
                        st.write(issue.get("status", "unknown"))
                    
                    st.divider()
        else:
            st.info("조회된 이슈가 없습니다.")
    else:
        st.warning("서버에 연결할 수 없습니다. FastAPI 서버가 실행 중인지 확인하세요.")


# ============================================================================
# 페이지: 이슈 상세
# ============================================================================

def page_issue_detail():
    """이슈 상세 페이지"""
    issue_id = st.session_state.get("selected_issue_id")
    
    if not issue_id:
        st.warning("이슈를 선택해주세요.")
        if st.button("← 목록으로"):
            st.session_state["page"] = "issues_list"
            st.rerun()
        return
    
    # 뒤로가기 버튼
    if st.button("← 목록으로"):
        st.session_state["page"] = "issues_list"
        st.rerun()
    
    # API 호출
    result = api_get(f"/api/issues/{issue_id}")
    
    if not result:
        st.error("이슈를 찾을 수 없습니다.")
        return
    
    # 헤더
    st.header(f"🐛 {result.get('title', 'Unknown Issue')}")
    
    # 기본 정보
    col1, col2, col3, col4 = st.columns(4)
    
    with col1:
        st.metric("레벨", result.get("level", "unknown").upper())
    with col2:
        st.metric("이벤트 수", result.get("eventCount", 0))
    with col3:
        st.metric("영향 유저 수", result.get("userCount", 0))
    with col4:
        st.metric("상태", result.get("status", "unknown"))
    
    st.divider()
    
    # 상세 정보
    col1, col2 = st.columns(2)
    
    with col1:
        st.subheader("📝 이슈 정보")
        st.write(f"**Sentry ID:** {result.get('sentryIssueId', 'N/A')}")
        st.write(f"**릴리즈:** {result.get('release', 'N/A')}")
        st.write(f"**환경:** {result.get('environment', 'N/A')}")
        st.write(f"**첫 발생:** {result.get('firstSeenAt', 'N/A')}")
        st.write(f"**마지막 발생:** {result.get('lastSeenAt', 'N/A')}")
        
        if result.get("sentryUrl"):
            st.markdown(f"[🔗 Sentry에서 보기]({result['sentryUrl']})")
    
    with col2:
        st.subheader("📊 분석 결과")
        
        analysis = result.get("analysis")
        
        if analysis:
            st.metric("우선순위 점수", f"{analysis.get('priorityScore', 'N/A')}/100")
            st.write(f"**원인 유형:** {analysis.get('causeType', 'N/A')}")
            st.write(f"**Edge Case 여부:** {'예' if analysis.get('isEdgeCase') else '아니오'}")
            
            if analysis.get("rootCause"):
                st.write("**근본 원인:**")
                st.info(analysis.get("rootCause"))
            
            if analysis.get("solution"):
                st.write("**해결 방안:**")
                st.success(analysis.get("solution"))
            
            if analysis.get("additionalInfo"):
                st.write("**추가 정보:**")
                st.write(analysis.get("additionalInfo"))
        else:
            st.info("아직 분석 결과가 없습니다.")
    
    st.divider()
    
    # AI 분석 다시 돌리기 버튼
    st.subheader("🤖 AI 분석")
    
    col1, col2 = st.columns([1, 3])
    
    with col1:
        if st.button("🔄 AI 분석 다시 돌리기", type="primary"):
            with st.spinner("분석 요청 중..."):
                result = api_post(f"/api/issues/{issue_id}/trigger-analysis")
                
                if result:
                    if result.get("status") == "error":
                        st.error(f"분석 요청 실패: {result.get('error')}")
                    else:
                        st.success(f"분석 요청 완료! Job ID: {result.get('jobId')}, 상태: {result.get('status')}")
                        st.info("분석이 완료되면 자동으로 결과가 업데이트됩니다.")
    
    with col2:
        if st.button("📋 분석 상태 확인"):
            with st.spinner("상태 확인 중..."):
                status_result = api_get(f"/api/issues/{issue_id}/analysis-status")
                
                if status_result:
                    st.write(f"**분석 상태:** {status_result.get('status')}")
                    if status_result.get("analysis"):
                        st.success("분석이 완료되었습니다. 페이지를 새로고침하세요.")


# ============================================================================
# 페이지: 수동 분석 입력
# ============================================================================

def page_manual_analysis():
    """수동 이슈 분석 입력 페이지"""
    st.header("🔍 수동 이슈 분석")
    
    st.markdown("""
    Sentry 이슈 ID 또는 URL을 입력하여 분석을 요청할 수 있습니다.
    DB에 없는 이슈도 분석 가능합니다.
    """)
    
    # 입력 폼
    issue_input = st.text_input(
        "이슈 ID 또는 URL",
        placeholder="12345 또는 https://sentry.io/organizations/.../issues/12345/",
        help="Sentry 이슈의 ID 또는 전체 URL을 입력하세요.",
    )
    
    force_refresh = st.checkbox("캐시 무시 (강제 재분석)", value=False)
    
    if st.button("🚀 분석 시작", type="primary", disabled=not issue_input):
        with st.spinner("분석 요청 중..."):
            result = api_post("/api/issues/manual-analysis", {
                "issueIdOrUrl": issue_input,
                "forceRefresh": force_refresh,
            })
            
            if result:
                if result.get("status") == "error":
                    st.error(f"분석 요청 실패: {result.get('error')}")
                else:
                    st.success(f"분석 요청 완료!")
                    st.write(f"**Job ID:** {result.get('jobId')}")
                    st.write(f"**상태:** {result.get('status')}")
                    st.info("분석이 완료되면 이슈 목록에서 확인할 수 있습니다.")


# ============================================================================
# 페이지: 리포트 리스트
# ============================================================================

def page_reports_list():
    """리포트 목록 페이지"""
    st.header("📊 리포트 목록")
    
    # 필터 옵션
    col1, col2 = st.columns(2)
    
    with col1:
        status_filter = st.selectbox(
            "상태",
            options=["전체", "queued", "running", "done", "error"],
            key="report_status_filter",
        )
    
    with col2:
        limit = st.number_input("표시 개수", min_value=5, max_value=100, value=20, key="report_limit")
    
    # API 호출
    params = {"limit": limit}
    if status_filter != "전체":
        params["status"] = status_filter
    
    result = api_get("/api/reports", params)
    
    if result:
        st.markdown(f"**전체 {result['total']}개 리포트 중 {len(result['items'])}개 표시**")
        
        if result["items"]:
            for report in result["items"]:
                with st.container():
                    col1, col2, col3, col4 = st.columns([3, 2, 1, 1])
                    
                    with col1:
                        title = report.get("title", "Untitled Report")
                        if st.button(
                            title,
                            key=f"report_{report['id']}",
                            help="클릭하여 상세 보기",
                        ):
                            st.session_state["selected_report_id"] = report["id"]
                            st.session_state["page"] = "report_detail"
                            st.rerun()
                    
                    with col2:
                        from_date = report.get("from_", "N/A")
                        to_date = report.get("to", "N/A")
                        st.write(f"📅 {from_date} ~ {to_date}")
                    
                    with col3:
                        status = report.get("status", "unknown")
                        status_icons = {
                            "queued": "⏳",
                            "running": "🔄",
                            "done": "✅",
                            "error": "❌",
                        }
                        st.write(f"{status_icons.get(status, '⚪')} {status}")
                    
                    with col4:
                        created_at = report.get("createdAt", "N/A")
                        if created_at and created_at != "N/A":
                            st.write(created_at[:10])
                        else:
                            st.write("N/A")
                    
                    st.divider()
        else:
            st.info("조회된 리포트가 없습니다.")
    else:
        st.warning("서버에 연결할 수 없습니다.")


# ============================================================================
# 페이지: 리포트 생성
# ============================================================================

def page_create_report():
    """리포트 생성 페이지"""
    st.header("📝 리포트 생성")
    
    st.markdown("""
    기간과 릴리즈 버전을 선택하여 크래시 리포트를 생성합니다.
    AI가 해당 기간의 이슈들을 분석하여 종합 리포트를 생성합니다.
    """)
    
    # 입력 폼
    col1, col2 = st.columns(2)
    
    with col1:
        from_date = st.date_input(
            "시작 날짜",
            value=date.today() - timedelta(days=30),
            max_value=date.today(),
        )
    
    with col2:
        to_date = st.date_input(
            "종료 날짜",
            value=date.today(),
            max_value=date.today(),
        )
    
    releases_input = st.text_area(
        "릴리즈 버전 (줄바꿈으로 구분)",
        placeholder="5.0.0\n5.1.0\n5.2.0",
        help="분석할 릴리즈 버전을 입력하세요. 비워두면 전체 버전을 대상으로 합니다.",
    )
    
    force_refresh = st.checkbox("캐시 무시 (강제 재생성)", value=False)
    
    if st.button("🚀 리포트 생성", type="primary"):
        # 릴리즈 파싱
        releases = [r.strip() for r in releases_input.split("\n") if r.strip()]
        
        with st.spinner("리포트 생성 요청 중..."):
            result = api_post("/api/reports", {
                "from_date": from_date.isoformat(),
                "to_date": to_date.isoformat(),
                "releases": releases,
                "forceRefresh": force_refresh,
            })
            
            if result:
                if result.get("error"):
                    st.error(f"리포트 생성 실패: {result.get('error')}")
                else:
                    st.success("리포트 생성 요청 완료!")
                    st.write(f"**리포트 ID:** {result.get('id')}")
                    st.write(f"**외부 ID:** {result.get('reportId')}")
                    st.write(f"**상태:** {result.get('status')}")
                    
                    if st.button("📊 리포트 상세 보기"):
                        st.session_state["selected_report_id"] = result.get("id")
                        st.session_state["page"] = "report_detail"
                        st.rerun()


# ============================================================================
# 페이지: 리포트 상세
# ============================================================================

def page_report_detail():
    """리포트 상세 페이지"""
    report_id = st.session_state.get("selected_report_id")
    
    if not report_id:
        st.warning("리포트를 선택해주세요.")
        if st.button("← 목록으로"):
            st.session_state["page"] = "reports_list"
            st.rerun()
        return
    
    # 뒤로가기 버튼
    if st.button("← 목록으로"):
        st.session_state["page"] = "reports_list"
        st.rerun()
    
    # API 호출
    result = api_get(f"/api/reports/{report_id}")
    
    if not result:
        st.error("리포트를 찾을 수 없습니다.")
        return
    
    # 헤더
    st.header(f"📊 {result.get('title', 'Report')}")
    
    # 기본 정보
    col1, col2, col3 = st.columns(3)
    
    with col1:
        st.metric("기간", f"{result.get('from', 'N/A')} ~ {result.get('to', 'N/A')}")
    with col2:
        releases = result.get("releases", [])
        st.metric("릴리즈", ", ".join(releases[:3]) if releases else "전체")
    with col3:
        status = result.get("status", "unknown")
        status_icons = {
            "queued": "⏳ 대기중",
            "running": "🔄 분석중",
            "done": "✅ 완료",
            "error": "❌ 오류",
        }
        st.metric("상태", status_icons.get(status, status))
    
    # 상태 새로고침 버튼
    if result.get("status") in ("queued", "running"):
        if st.button("🔄 상태 새로고침"):
            refresh_result = api_post(f"/api/reports/{report_id}/refresh")
            if refresh_result:
                st.rerun()
    
    st.divider()
    
    # 리포트 내용
    if result.get("status") == "done":
        # 요약
        if result.get("summary"):
            st.subheader("📋 요약")
            st.markdown(result.get("summary"))
        
        # 해결된 이슈
        if result.get("resolvedIssues"):
            st.subheader("✅ 해결된 이슈")
            st.markdown(result.get("resolvedIssues"))
        
        # 미해결 이슈
        if result.get("remainingIssues"):
            st.subheader("🔴 미해결 이슈")
            st.markdown(result.get("remainingIssues"))
        
        # 반복 이슈
        if result.get("recurringIssues"):
            st.subheader("🔄 반복 발생 이슈")
            st.markdown(result.get("recurringIssues"))
        
        # 액션 아이템
        if result.get("actionItems"):
            st.subheader("📌 액션 아이템")
            st.markdown(result.get("actionItems"))
        
        # 인사이트
        if result.get("insights"):
            st.subheader("💡 인사이트")
            st.markdown(result.get("insights"))
    
    elif result.get("status") == "error":
        st.error("리포트 생성 중 오류가 발생했습니다.")
    
    else:
        st.info("리포트가 아직 생성 중입니다. 잠시 후 다시 확인해주세요.")


# ============================================================================
# 사이드바 네비게이션
# ============================================================================

def sidebar_navigation():
    """사이드바 네비게이션"""
    with st.sidebar:
        st.title("🐛 Sentry AI Assistant")
        st.divider()
        
        # 이슈 섹션
        st.subheader("Issues")
        
        if st.button("📋 이슈 목록", use_container_width=True):
            st.session_state["page"] = "issues_list"
            st.rerun()
        
        if st.button("🔍 수동 분석", use_container_width=True):
            st.session_state["page"] = "manual_analysis"
            st.rerun()
        
        st.divider()
        
        # 리포트 섹션
        st.subheader("Reports")
        
        if st.button("📊 리포트 목록", use_container_width=True):
            st.session_state["page"] = "reports_list"
            st.rerun()
        
        if st.button("📝 리포트 생성", use_container_width=True):
            st.session_state["page"] = "create_report"
            st.rerun()
        
        st.divider()
        
        # 서버 상태
        st.subheader("Status")
        health = api_get("/health")
        if health and health.get("status") == "ok":
            st.success("🟢 서버 정상")
            st.caption(f"환경: {health.get('app_env', 'N/A')}")
        else:
            st.error("🔴 서버 연결 실패")
            st.caption(f"URL: {API_BASE_URL}")


# ============================================================================
# 메인
# ============================================================================

def main():
    """메인 함수"""
    # 세션 상태 초기화
    if "page" not in st.session_state:
        st.session_state["page"] = "issues_list"
    
    # 사이드바
    sidebar_navigation()
    
    # 페이지 라우팅
    page = st.session_state.get("page", "issues_list")
    
    if page == "issues_list":
        page_issues_list()
    elif page == "issue_detail":
        page_issue_detail()
    elif page == "manual_analysis":
        page_manual_analysis()
    elif page == "reports_list":
        page_reports_list()
    elif page == "create_report":
        page_create_report()
    elif page == "report_detail":
        page_report_detail()
    else:
        page_issues_list()


if __name__ == "__main__":
    main()
