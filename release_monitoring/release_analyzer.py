"""
릴리즈 분석 모듈
Sentry API를 통한 크래시 데이터 수집 및 분석
"""

import re
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Tuple

import requests

from config import (
    SENTRY_API_BASE, HEADERS, PROJECT_SLUG, ORG_SLUG, ENVIRONMENT,
    ALERT_THRESHOLDS, TEST_MODE, utc_to_kst
)


def test_sentry_connection() -> bool:
    """Sentry API 연결 테스트"""
    try:
        test_url = f"{SENTRY_API_BASE}/projects/{ORG_SLUG}/{PROJECT_SLUG}/"
        response = requests.get(test_url, headers=HEADERS, timeout=10)

        if response.status_code == 200:
            project_info = response.json()
            print(f"✅ Sentry 연결 성공: {project_info.get('name')} ({project_info.get('platform')})")
            return True
        else:
            print(f"❌ Sentry 연결 실패: {response.status_code}")
            return False

    except Exception as e:
        print(f"❌ Sentry 연결 테스트 오류: {e}")
        return False


def get_release_timeframe(release_start: datetime, analysis_period_hours: int = 24) -> Tuple[datetime, datetime]:
    """릴리즈 분석 시간 범위 계산"""
    # 릴리즈 시작 시간부터 지정된 시간까지
    start_time = release_start
    end_time = min(
        release_start + timedelta(hours=analysis_period_hours),
        datetime.now(timezone.utc)  # 현재 시간을 넘지 않도록
    )

    return start_time, end_time


def collect_release_issues(start_time: datetime, end_time: datetime,
                           release_version: str = None) -> List[Dict]:
    """릴리즈 기간의 이슈 수집"""

    start_str = start_time.isoformat()
    end_str = end_time.isoformat()

    issues_url = f"{SENTRY_API_BASE}/projects/{ORG_SLUG}/{PROJECT_SLUG}/issues/"
    all_issues = []

    # 기본 쿼리
    base_query = f'firstSeen:>={start_str} firstSeen:<{end_str} environment:{ENVIRONMENT}'

    # 릴리즈 버전이 지정되어 있으면 추가
    if release_version:
        base_query += f' release:{release_version}'

    if TEST_MODE:
        # 한국 시간으로 변환하여 출력
        start_kst = utc_to_kst(start_time)
        end_kst = utc_to_kst(end_time)
        print(f"🔍 이슈 수집 중: {start_kst.strftime('%m/%d %H:%M')} ~ {end_kst.strftime('%m/%d %H:%M')} KST")
        if release_version:
            print(f"   릴리즈: {release_version}")

    cursor = None
    page = 1
    max_pages = 10  # 최대 10페이지로 제한

    while page <= max_pages:
        params = {
            'query': base_query,
            'limit': 100,
            'sort': 'date',
            'environment': ENVIRONMENT
        }

        if cursor:
            params['cursor'] = cursor

        try:
            response = requests.get(issues_url, headers=HEADERS, params=params, timeout=15)

            if response.status_code != 200:
                if TEST_MODE:
                    print(f"   ❌ API 응답 오류: {response.status_code}")
                break

            page_issues = response.json()

            if not page_issues:
                break

            all_issues.extend(page_issues)

            if TEST_MODE:
                print(f"   페이지 {page}: {len(page_issues)}개 수집 (총 {len(all_issues)}개)")

            # 다음 페이지 확인
            link_header = response.headers.get('Link', '')
            if 'rel="next"' not in link_header:
                break

            cursor_match = re.search(r'cursor=([^&>]+).*rel="next"', link_header)
            if cursor_match:
                cursor = cursor_match.group(1)
                page += 1
            else:
                break

        except Exception as e:
            if TEST_MODE:
                print(f"   ❌ 이슈 수집 오류: {e}")
            break

    if TEST_MODE:
        print(f"   ✅ 총 {len(all_issues)}개 이슈 수집 완료")

    return all_issues


def analyze_crash_issues(issues: List[Dict]) -> Dict:
    """크래시 이슈 분석"""
    crash_issues = []

    # 크래시 레벨 이슈만 필터링
    for issue in issues:
        level = issue.get('level', '').lower()
        if level in ['error', 'fatal']:
            crash_issues.append(issue)

    if TEST_MODE:
        print(f"   📊 전체 {len(issues)}개 이슈 중 {len(crash_issues)}개 크래시 이슈")

    # 크래시 통계 계산
    total_crash_events = 0
    total_affected_users = set()
    crash_by_level = {'error': 0, 'fatal': 0}
    top_issues = []

    for issue in crash_issues:
        # 이벤트 수 (count 필드 사용)
        event_count = safe_int(issue.get('count', 0))
        total_crash_events += event_count

        # 레벨별 분류
        level = issue.get('level', '').lower()
        if level in crash_by_level:
            crash_by_level[level] += event_count

        # 영향받은 사용자 (userCount 사용)
        user_count = safe_int(issue.get('userCount', 0))
        if user_count > 0:
            # 실제로는 중복 제거가 어려우므로 대략적으로 추정
            for i in range(min(user_count, event_count)):
                total_affected_users.add(f"{issue.get('id', '')}_{i}")

        # 상위 이슈 수집 (이벤트 수 기준)
        if event_count > 0:
            top_issues.append({
                'id': issue.get('id'),
                'title': issue.get('title', 'Unknown Issue'),
                'level': level,
                'count': event_count,
                'users': user_count,
                'permalink': issue.get('permalink'),
                'first_seen': issue.get('firstSeen'),
                'last_seen': issue.get('lastSeen')
            })

    # 상위 이슈 정렬
    top_issues.sort(key=lambda x: x['count'], reverse=True)

    analysis_result = {
        'total_crashes': total_crash_events,
        'total_issues': len(crash_issues),
        'affected_users': len(total_affected_users),
        'crash_by_level': crash_by_level,
        'top_issues': top_issues[:10],  # 상위 10개
        'analysis_time': datetime.now(timezone.utc).isoformat()
    }

    if TEST_MODE:
        print(f"   📈 분석 결과:")
        print(f"      - 총 크래시: {total_crash_events}건")
        print(f"      - 크래시 이슈: {len(crash_issues)}개")
        print(f"      - 영향 사용자: {len(total_affected_users)}명 (추정)")
        print(f"      - Error: {crash_by_level['error']}건, Fatal: {crash_by_level['fatal']}건")

    return analysis_result


def get_baseline_comparison(release_start: datetime, analysis_hours: int = 24) -> Dict:
    """베이스라인 비교를 위한 이전 기간 데이터 수집"""

    # 릴리즈 이전 동일 기간의 데이터 수집
    baseline_end = release_start
    baseline_start = baseline_end - timedelta(hours=analysis_hours)

    if TEST_MODE:
        # 한국 시간으로 변환하여 출력
        start_kst = utc_to_kst(baseline_start)
        end_kst = utc_to_kst(baseline_end)
        print(f"🔍 베이스라인 데이터 수집 중: {start_kst.strftime('%m/%d %H:%M')} ~ {end_kst.strftime('%m/%d %H:%M')} KST")

    baseline_issues = collect_release_issues(baseline_start, baseline_end)
    baseline_analysis = analyze_crash_issues(baseline_issues)

    return baseline_analysis


def calculate_risk_level(current_analysis: Dict, baseline_analysis: Dict) -> Tuple[int, str, str]:
    """위험도 레벨 계산"""

    current_crashes = current_analysis['total_crashes']
    baseline_crashes = baseline_analysis['total_crashes']
    current_users = current_analysis['affected_users']

    # 새로운 Fatal 크래시 체크
    current_fatal = current_analysis['crash_by_level']['fatal']
    baseline_fatal = baseline_analysis['crash_by_level']['fatal']

    # Level 5: 긴급 (새로운 Fatal 크래시 다수)
    if current_fatal > baseline_fatal + 5:
        return 5, "긴급", f"새로운 Fatal 크래시 {current_fatal - baseline_fatal}건 발생"

    # Level 4-1: 크래시 증가율 기준
    if baseline_crashes > 0:
        increase_rate = (current_crashes - baseline_crashes) / baseline_crashes

        if increase_rate >= 1.0:  # 100% 이상 증가
            return 4, "위험", f"크래시 {increase_rate * 100:.0f}% 증가 ({baseline_crashes}→{current_crashes}건)"
        elif increase_rate >= 0.5:  # 50% 이상 증가
            return 3, "경고", f"크래시 {increase_rate * 100:.0f}% 증가 ({baseline_crashes}→{current_crashes}건)"
        elif increase_rate >= 0.1:  # 10% 이상 증가
            return 2, "주의", f"크래시 {increase_rate * 100:.0f}% 증가 ({baseline_crashes}→{current_crashes}건)"
    elif current_crashes > ALERT_THRESHOLDS['new_crash_threshold']:
        # 베이스라인이 0이지만 현재 크래시가 많은 경우
        return 4, "위험", f"신규 크래시 {current_crashes}건 발생"

    # 사용자 영향 기준
    if current_users >= ALERT_THRESHOLDS['critical_user_impact']:
        current_level = max(2, 2)  # 최소 주의 단계
        return current_level, "주의", f"{current_users}명 사용자 영향"

    # Level 1: 정상
    return 1, "정상", "안정적인 상태"


def analyze_release_impact(release: Dict) -> Dict:
    """릴리즈 영향 분석"""

    release_version = release['version']
    release_start = datetime.fromisoformat(release['start_time'].replace('Z', '+00:00'))

    # 현재까지의 분석 기간 계산 (최대 24시간)
    now = datetime.now(timezone.utc)
    elapsed_hours = min(24, (now - release_start).total_seconds() / 3600)

    if elapsed_hours < 0.25:  # 15분 미만이면 최소 15분
        elapsed_hours = 0.25

    if TEST_MODE:
        # 한국 시간으로 변환하여 출력
        release_start_kst = utc_to_kst(release_start)
        print(f"\n🔍 릴리즈 {release_version} 영향 분석 시작")
        print(f"   📅 릴리즈 시작: {release_start_kst.strftime('%Y-%m-%d %H:%M:%S')} KST")
        print(f"   ⏱️ 경과 시간: {elapsed_hours:.1f}시간")

    # 릴리즈 기간 데이터 수집
    analysis_start, analysis_end = get_release_timeframe(release_start, int(elapsed_hours))

    # 현재 릴리즈 데이터 분석
    current_issues = collect_release_issues(analysis_start, analysis_end, release_version)
    current_analysis = analyze_crash_issues(current_issues)

    # 베이스라인 비교 데이터
    baseline_analysis = get_baseline_comparison(release_start, int(elapsed_hours))

    # 위험도 계산
    risk_level, risk_status, risk_reason = calculate_risk_level(current_analysis, baseline_analysis)

    # 상위 이슈 상세 분석
    critical_issues = []
    for issue in current_analysis['top_issues'][:5]:
        if issue['count'] >= ALERT_THRESHOLDS['new_crash_threshold']:
            critical_issues.append({
                'title': format_issue_title(issue['title']),
                'level': issue['level'],
                'count': issue['count'],
                'users': issue['users'],
                'id': issue['id'],
                'sentry_url': f"https://sentry.io/organizations/{ORG_SLUG}/issues/{issue['id']}/"
            })

    result = {
        'release_version': release_version,
        'analysis_period': {
            'start': analysis_start.isoformat(),
            'end': analysis_end.isoformat(),
            'hours': elapsed_hours
        },
        'current_analysis': current_analysis,
        'baseline_analysis': baseline_analysis,
        'risk_assessment': {
            'level': risk_level,
            'status': risk_status,
            'reason': risk_reason
        },
        'critical_issues': critical_issues,
        'recommendations': generate_recommendations(risk_level, current_analysis),
        'analyzed_at': datetime.now(timezone.utc).isoformat()
    }

    if TEST_MODE:
        print(f"   🎯 위험도: Level {risk_level} ({risk_status})")
        print(f"   📝 사유: {risk_reason}")
        if critical_issues:
            print(f"   🔥 중요 이슈: {len(critical_issues)}개")

    return result


def generate_recommendations(risk_level: int, analysis: Dict) -> List[str]:
    """위험도에 따른 권장사항 생성"""
    recommendations = []

    if risk_level >= 4:
        recommendations.extend([
            "🚨 즉시 롤백 검토 필요",
            "📞 개발팀 긴급 소집",
            "🔍 상위 크래시 이슈 우선 분석",
            "📊 사용자 영향 범위 확인"
        ])
    elif risk_level == 3:
        recommendations.extend([
            "⚠️ 크래시 패턴 모니터링 강화",
            "🔧 핫픽스 준비 검토",
            "📈 1시간 후 재분석 권장"
        ])
    elif risk_level == 2:
        recommendations.extend([
            "👀 지속적인 모니터링 필요",
            "📋 이슈 트래킹 강화"
        ])
    else:
        recommendations.extend([
            "✅ 안정적인 배포 상태",
            "📊 정기 모니터링 계속"
        ])

    # 특정 조건에 따른 추가 권장사항
    if analysis['crash_by_level']['fatal'] > 0:
        recommendations.append("💀 Fatal 크래시 우선 처리")

    if analysis['affected_users'] > 50:
        recommendations.append("👥 사용자 영향 최소화 조치")

    return recommendations


def safe_int(value, default=0):
    """안전한 정수 변환"""
    try:
        if isinstance(value, (int, float)):
            return int(value)
        elif isinstance(value, str) and value.isdigit():
            return int(value)
        else:
            return default
    except (ValueError, TypeError):
        return default


def format_issue_title(title: str, max_length: int = 50) -> str:
    """이슈 제목 포맷팅"""
    if not title:
        return "Unknown Issue"

    # 길이 제한
    if len(title) > max_length:
        title = title[:max_length - 3] + "..."

    # Slack에서 문제될 수 있는 특수문자 제거
    title = title.replace('*', '').replace('_', '').replace('`', '')

    return title


def get_trend_emoji(current: int, previous: int) -> str:
    """증감 추세 이모지"""
    if current == 0 and previous == 0:
        return "➡️"
    elif current == 0:
        return "🎉"
    elif previous == 0:
        return "🚨"

    change_percent = ((current - previous) / previous) * 100

    if change_percent <= -50:
        return "📉"
    elif change_percent <= -10:
        return "↘️"
    elif change_percent >= 50:
        return "📈"
    elif change_percent >= 10:
        return "↗️"
    else:
        return "➡️"


def get_crash_free_rate(start_time: datetime, end_time: datetime) -> str:
    """Crash-Free Rate 조회"""
    import os

    sessions_url = f"{SENTRY_API_BASE}/organizations/{ORG_SLUG}/sessions/"

    params = {
        'field': ['crash_free_rate(session)'],
        'start': start_time.isoformat(),
        'end': end_time.isoformat(),
        'project': [os.getenv('SENTRY_PROJECT_ID')],
        'environment': [ENVIRONMENT],
        'totals': 1
    }

    try:
        response = requests.get(sessions_url, headers=HEADERS, params=params, timeout=30)

        if response.status_code == 200:
            data = response.json()

            if 'groups' in data and data['groups']:
                for group in data['groups']:
                    totals = group.get('totals', {})
                    session_crash_free = totals.get('crash_free_rate(session)')

                    if session_crash_free is not None:
                        rate = session_crash_free * 100 if session_crash_free <= 1 else session_crash_free
                        return f"{rate:.2f}%"

        if TEST_MODE:
            print("   ⚠️ Crash-Free Rate 데이터를 가져올 수 없습니다")

    except Exception as e:
        if TEST_MODE:
            print(f"   ❌ Crash-Free Rate 조회 오류: {e}")

    return "N/A"