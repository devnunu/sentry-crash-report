"""
릴리즈 분석 모듈 - 슬라이딩 윈도우 방식 + 레벨링 시스템 + 릴리즈 버전 필터링
"""

import re
import time
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Tuple

import requests

from config import (
    SENTRY_API_BASE, HEADERS, PROJECT_SLUG, ORG_SLUG, ENVIRONMENT,
    MONITORING_PERIODS, TEST_MODE, utc_to_kst,
    CRASH_ALERT_LEVELS, SINGLE_ISSUE_LEVELS, FATAL_ALERT_LEVELS, USER_IMPACT_LEVELS,
    get_alert_level
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


def debug_sentry_releases():
    """Sentry에 등록된 릴리즈 목록 확인 (디버깅용)"""
    if not TEST_MODE:
        return

    releases_url = f"{SENTRY_API_BASE}/projects/{ORG_SLUG}/{PROJECT_SLUG}/releases/"

    try:
        params = {'per_page': 20}
        response = requests.get(releases_url, headers=HEADERS, params=params, timeout=10)
        if response.status_code == 200:
            releases = response.json()
            print(f"\n📦 Sentry에 등록된 최근 릴리즈 ({len(releases)}개):")
            for release in releases[:10]:
                version = release.get('version')
                date_created = release.get('dateCreated', '').split('T')[0]
                print(f"   - {version} ({date_created})")

            return [r.get('version') for r in releases]
        else:
            print(f"❌ 릴리즈 조회 실패: {response.status_code}")
            return []
    except Exception as e:
        print(f"❌ 릴리즈 디버깅 오류: {e}")
        return []


def get_release_version_variations(version: str) -> List[str]:
    """릴리즈 버전의 다양한 형태 반환 (Sentry에서 태그되는 방식이 다를 수 있음)"""
    if not version:
        return []

    variations = [version]

    # 일반적인 버전 형태들
    if version.startswith('v'):
        variations.append(version[1:])  # v1.2.3 -> 1.2.3
    else:
        variations.append(f'v{version}')  # 1.2.3 -> v1.2.3

    # Android 앱의 경우 빌드 번호가 포함될 수 있음
    if '-' in version:
        base_version = version.split('-')[0]
        variations.extend([base_version, f'v{base_version}'])

    # 점(.) 구분자 처리
    if '.' in version:
        # 1.2.3 -> 1-2-3 형태도 시도
        dash_version = version.replace('.', '-')
        variations.append(dash_version)
        if not dash_version.startswith('v'):
            variations.append(f'v{dash_version}')

    return list(set(variations))  # 중복 제거


def get_sliding_window_timeframe(release_start: datetime) -> Tuple[datetime, datetime, str]:
    """슬라이딩 윈도우 시간 범위 계산"""
    now = datetime.now(timezone.utc)
    window_hours = MONITORING_PERIODS['analysis_window_hours']

    # 릴리즈 후 경과 시간
    elapsed = now - release_start
    elapsed_hours = elapsed.total_seconds() / 3600

    if elapsed_hours <= window_hours:
        # 릴리즈 후 24시간 이내: 릴리즈 시작부터 현재까지
        analysis_start = release_start
        analysis_end = now
        period_desc = f"릴리즈 후 {elapsed_hours:.1f}시간"
    else:
        # 릴리즈 후 24시간 이후: 최근 24시간 슬라이딩 윈도우
        analysis_end = now
        analysis_start = now - timedelta(hours=window_hours)
        period_desc = f"최근 {window_hours}시간 (슬라이딩 윈도우)"

    return analysis_start, analysis_end, period_desc


def collect_release_issues(start_time: datetime, end_time: datetime,
                           release_version: str = None) -> List[Dict]:
    """슬라이딩 윈도우 기간의 이슈 수집 (릴리즈 버전 필터링 포함)"""

    start_str = start_time.isoformat()
    end_str = end_time.isoformat()

    issues_url = f"{SENTRY_API_BASE}/projects/{ORG_SLUG}/{PROJECT_SLUG}/issues/"
    all_issues = []
    all_issue_ids = set()  # 중복 제거용

    # 릴리즈 버전 필터 준비
    release_filter = ""
    version_variations = []

    if release_version:
        version_variations = get_release_version_variations(release_version)
        # 첫 번째 변형을 기본으로 사용
        release_filter = f" release:{version_variations[0]}"

        if TEST_MODE:
            print(f"🎯 릴리즈 버전 필터 적용: {release_version}")
            print(f"   시도할 버전 형태: {version_variations}")

    # 기본 쿼리 - firstSeen과 lastSeen 모두 고려 + 릴리즈 필터
    base_query = f'firstSeen:>={start_str} firstSeen:<{end_str} environment:{ENVIRONMENT}{release_filter}'
    lastSeen_query = f'lastSeen:>={start_str} lastSeen:<{end_str} environment:{ENVIRONMENT}{release_filter}'

    if TEST_MODE:
        start_kst = utc_to_kst(start_time)
        end_kst = utc_to_kst(end_time)
        print(f"🔍 이슈 수집 중: {start_kst.strftime('%m/%d %H:%M')} ~ {end_kst.strftime('%m/%d %H:%M')} KST")
        print(f"   환경: {ENVIRONMENT}")
        if release_version:
            print(f"   릴리즈 필터: {release_filter}")

    # 1단계: firstSeen 기준 이슈 수집
    cursor = None
    page = 1
    max_pages = 20

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
                    print(f"   ❌ firstSeen API 응답 오류: {response.status_code}")
                break

            page_issues = response.json()
            if not page_issues:
                break

            # ID가 유효한 이슈만 추가
            added_count = 0
            for issue in page_issues:
                issue_id = issue.get('id')
                if issue_id and issue_id not in all_issue_ids:
                    # 릴리즈 버전 필터링이 적용된 경우 추가 검증
                    if release_version and not is_issue_from_release(issue, version_variations):
                        continue

                    all_issues.append(issue)
                    all_issue_ids.add(issue_id)
                    added_count += 1

            if TEST_MODE:
                print(f"   firstSeen 페이지 {page}: {len(page_issues)}개 조회, {added_count}개 새로 추가")

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
                print(f"   ❌ firstSeen 이슈 수집 오류: {e}")
            break

    # 2단계: lastSeen 기준 이슈 추가 수집 (릴리즈 버전이 있는 경우에만)
    if not release_version:
        lastSeen_cursor = None
        lastSeen_page = 1
        max_lastSeen_pages = 10

        while lastSeen_page <= max_lastSeen_pages:
            lastSeen_params = {
                'query': lastSeen_query,
                'limit': 100,
                'sort': 'date',
                'environment': ENVIRONMENT
            }

            if lastSeen_cursor:
                lastSeen_params['cursor'] = lastSeen_cursor

            try:
                response = requests.get(issues_url, headers=HEADERS, params=lastSeen_params, timeout=15)

                if response.status_code != 200:
                    break

                lastSeen_issues = response.json()
                if not lastSeen_issues:
                    break

                added_count = 0
                for issue in lastSeen_issues:
                    issue_id = issue.get('id')
                    if issue_id and issue_id not in all_issue_ids:
                        all_issues.append(issue)
                        all_issue_ids.add(issue_id)
                        added_count += 1

                if TEST_MODE and lastSeen_page <= 3:
                    print(f"   lastSeen 페이지 {lastSeen_page}: {added_count}개 새로 추가")

                # 다음 페이지 확인
                link_header = response.headers.get('Link', '')
                if 'rel="next"' not in link_header:
                    break

                cursor_match = re.search(r'cursor=([^&>]+).*rel="next"', link_header)
                if cursor_match:
                    lastSeen_cursor = cursor_match.group(1)
                    lastSeen_page += 1
                else:
                    break

            except Exception as e:
                if TEST_MODE:
                    print(f"   ❌ lastSeen 이슈 수집 오류: {e}")
                break

    if TEST_MODE:
        print(f"   ✅ 총 {len(all_issues)}개 이슈 수집 완료 (고유 ID: {len(all_issue_ids)}개)")
        if release_version and all_issues:
            # 실제로 수집된 이슈의 릴리즈 태그 분석
            debug_issue_release_tags(all_issues[:5], release_version)

    return all_issues


def is_issue_from_release(issue: Dict, version_variations: List[str]) -> bool:
    """이슈가 지정된 릴리즈 버전에서 발생했는지 확인"""
    if not version_variations:
        return True

    # 이슈의 릴리즈 태그 확인
    tags = issue.get('tags', [])
    release_tags = [tag['value'] for tag in tags if tag.get('key') == 'release']

    # 버전 변형 중 하나라도 매치되면 True
    for release_tag in release_tags:
        for version in version_variations:
            if version == release_tag or release_tag.endswith(version) or version in release_tag:
                return True

    # 릴리즈 태그가 없는 경우에도 포함 (기본 동작)
    return len(release_tags) == 0


def debug_issue_release_tags(issues: List[Dict], target_version: str):
    """이슈의 릴리즈 태그 분석 (디버깅용)"""
    if not TEST_MODE or not issues:
        return

    print(f"\n🏷️ 상위 {len(issues)}개 이슈의 릴리즈 태그 분석 (대상: {target_version}):")

    tag_summary = {}

    for i, issue in enumerate(issues):
        title = issue.get('title', 'Unknown')[:40]
        tags = issue.get('tags', [])
        release_tags = [tag['value'] for tag in tags if tag.get('key') == 'release']

        print(f"   {i+1}. {title}...")
        if release_tags:
            print(f"      릴리즈: {release_tags}")
            for tag in release_tags:
                tag_summary[tag] = tag_summary.get(tag, 0) + 1
        else:
            print(f"      릴리즈 태그 없음")
            tag_summary['(없음)'] = tag_summary.get('(없음)', 0) + 1

    print(f"\n📊 릴리즈 태그 요약:")
    for tag, count in sorted(tag_summary.items(), key=lambda x: x[1], reverse=True):
        print(f"   - {tag}: {count}개")


def collect_release_issues_with_fallback(start_time: datetime, end_time: datetime,
                                        release_version: str = None) -> List[Dict]:
    """릴리즈 버전으로 먼저 필터링하고, 결과가 적으면 전체 조회로 fallback"""

    if not release_version:
        return collect_release_issues(start_time, end_time, None)

    # 1차: 릴리즈 버전으로 필터링
    version_variations = get_release_version_variations(release_version)

    for version in version_variations:
        issues = collect_release_issues(start_time, end_time, version)
        if len(issues) >= 5:  # 최소 5개 이상의 이슈가 있으면 성공으로 간주
            if TEST_MODE:
                print(f"✅ 릴리즈 버전 '{version}'으로 {len(issues)}개 이슈 발견")
            return issues

    # 2차: 릴리즈 태그가 없거나 다른 형태일 수 있으므로 전체 조회
    if TEST_MODE:
        print(f"⚠️ 릴리즈 버전 필터로 충분한 이슈를 찾을 수 없음. 전체 이슈 조회로 fallback")
        print(f"   (시도한 버전: {version_variations})")

    all_issues = collect_release_issues(start_time, end_time, None)

    # 전체 이슈에서 릴리즈 버전과 관련된 것들을 우선적으로 필터링
    if all_issues and release_version:
        related_issues = []
        other_issues = []

        for issue in all_issues:
            if is_issue_from_release(issue, version_variations):
                related_issues.append(issue)
            else:
                other_issues.append(issue)

        if TEST_MODE:
            print(f"   전체 {len(all_issues)}개 중 {len(related_issues)}개가 릴리즈와 관련됨")

        # 관련 이슈가 있으면 우선 반환, 없으면 전체 반환
        return related_issues if related_issues else all_issues

    return all_issues


def get_issue_events_in_window(issue_id: str, start_time: datetime, end_time: datetime) -> int:
    """특정 시간 윈도우 내 이슈의 이벤트 수 조회"""
    events_url = f"{SENTRY_API_BASE}/issues/{issue_id}/events/"
    total_events = 0
    cursor = None
    max_pages = 5

    for page in range(max_pages):
        params = {'limit': 100}
        if cursor:
            params['cursor'] = cursor

        try:
            response = requests.get(events_url, headers=HEADERS, params=params, timeout=10)

            if response.status_code != 200:
                break

            events = response.json()
            if not events:
                break

            # 시간 범위 내 이벤트만 카운트
            for event in events:
                event_time_str = event.get('dateCreated')
                if event_time_str:
                    try:
                        event_time = datetime.fromisoformat(event_time_str.replace('Z', '+00:00'))
                        if start_time <= event_time <= end_time:
                            total_events += 1
                        elif event_time < start_time:
                            return total_events  # 시간 범위를 벗어나면 종료
                    except:
                        pass

            # 다음 페이지 체크
            link_header = response.headers.get('Link', '')
            if 'rel="next"' not in link_header:
                break

            cursor_match = re.search(r'cursor=([^&>]+).*rel="next"', link_header)
            if cursor_match:
                cursor = cursor_match.group(1)
            else:
                break

        except:
            break

    return total_events


def analyze_crash_issues_with_levels(issues: List[Dict], start_time: datetime, end_time: datetime) -> Dict:
    """레벨링 시스템을 적용한 크래시 이슈 분석"""
    crash_issues = []
    non_crash_levels = set()

    # 크래시 레벨 이슈만 필터링
    for issue in issues:
        level = issue.get('level', '').lower()
        if level in ['error', 'fatal']:
            if issue.get('id'):
                crash_issues.append(issue)
        else:
            non_crash_levels.add(level)

    if TEST_MODE:
        print(f"   📊 전체 {len(issues)}개 이슈 중 {len(crash_issues)}개 크래시 이슈")
        if non_crash_levels:
            print(f"   🔍 크래시가 아닌 레벨들: {sorted(non_crash_levels)}")

    # 윈도우 기간 내 실제 이벤트 수 계산
    total_crash_events = 0
    total_fatal_events = 0
    total_affected_users = set()
    top_issues = []

    # 성능을 위해 상위 50개 이슈만 처리
    crash_issues_sorted = sorted(crash_issues, key=lambda x: safe_int(x.get('count', 0)), reverse=True)
    top_crash_issues = crash_issues_sorted[:50]

    if TEST_MODE:
        print(f"   🔄 상위 {len(top_crash_issues)}개 이슈의 윈도우 내 이벤트 수 계산 중...")

    for i, issue in enumerate(top_crash_issues):
        issue_id = issue.get('id')
        if not issue_id:
            continue

        # 윈도우 내 실제 이벤트 수 조회
        window_events = get_issue_events_in_window(issue_id, start_time, end_time)

        if window_events > 0:
            issue_level = issue.get('level', '').lower()
            total_crash_events += window_events

            if issue_level == 'fatal':
                total_fatal_events += window_events

            # 사용자 수 추정 (윈도우 기간 비례)
            user_count = safe_int(issue.get('userCount', 0))
            estimated_window_users = min(user_count, window_events)

            for user_idx in range(estimated_window_users):
                total_affected_users.add(f"{issue_id}_{user_idx}")

            top_issues.append({
                'id': issue_id,
                'title': issue.get('title', 'Unknown Issue'),
                'level': issue_level,
                'window_count': window_events,
                'total_count': safe_int(issue.get('count', 0)),
                'users': estimated_window_users,
                'first_seen': issue.get('firstSeen'),
                'last_seen': issue.get('lastSeen')
            })

        # 진행 상황 표시
        if (i + 1) % 10 == 0 and TEST_MODE:
            print(f"      {i + 1}/{len(top_crash_issues)} 처리 완료...")

        # API 부하 방지
        if (i + 1) % 10 == 0:
            time.sleep(0.1)

    # 이벤트 수 기준으로 정렬
    top_issues.sort(key=lambda x: x['window_count'], reverse=True)

    # 레벨 계산
    crash_level = get_alert_level(total_crash_events, CRASH_ALERT_LEVELS)
    fatal_level = get_alert_level(total_fatal_events, FATAL_ALERT_LEVELS)
    user_level = get_alert_level(len(total_affected_users), USER_IMPACT_LEVELS)

    # 단일 이슈 레벨 (가장 높은 단일 이슈 기준)
    max_single_issue_count = max([issue['window_count'] for issue in top_issues], default=0)
    single_issue_level = get_alert_level(max_single_issue_count, SINGLE_ISSUE_LEVELS)

    # 전체 위험도는 가장 높은 레벨 기준
    overall_level = max(
        crash_level.get('level', 0),
        fatal_level.get('level', 0),
        user_level.get('level', 0),
        single_issue_level.get('level', 0)
    )

    analysis_result = {
        'total_crashes': total_crash_events,
        'total_fatal': total_fatal_events,
        'total_issues': len([issue for issue in top_issues if issue['window_count'] > 0]),
        'affected_users': len(total_affected_users),
        'top_issues': top_issues[:10],
        'levels': {
            'overall': overall_level,
            'crash': crash_level,
            'fatal': fatal_level,
            'user_impact': user_level,
            'single_issue': single_issue_level
        },
        'analysis_time': datetime.now(timezone.utc).isoformat()
    }

    if TEST_MODE:
        print(f"   📈 분석 결과:")
        print(f"      - 윈도우 내 크래시: {total_crash_events}건")
        print(f"      - 윈도우 내 Fatal: {total_fatal_events}건")
        print(f"      - 크래시 이슈: {analysis_result['total_issues']}개")
        print(f"      - 영향 사용자: {len(total_affected_users)}명 (추정)")
        print(f"      - 전체 위험도: Level {overall_level}")
        print(f"      - 크래시 레벨: Level {crash_level.get('level', 0)} ({crash_level.get('status', '정상')})")
        print(f"      - Fatal 레벨: Level {fatal_level.get('level', 0)} ({fatal_level.get('status', '정상')})")

    return analysis_result


def analyze_release_impact(release: Dict) -> Dict:
    """슬라이딩 윈도우 방식 릴리즈 영향 분석 (릴리즈 버전 필터링 포함)"""

    release_version = release['version']
    release_start = datetime.fromisoformat(release['start_time'].replace('Z', '+00:00'))

    if TEST_MODE:
        release_start_kst = utc_to_kst(release_start)
        print(f"\n🔍 릴리즈 {release_version} 영향 분석 시작")
        print(f"   📅 릴리즈 시작: {release_start_kst.strftime('%Y-%m-%d %H:%M:%S')} KST")

    # 디버깅: Sentry에 등록된 릴리즈 확인
    if TEST_MODE:
        debug_sentry_releases()

    # 슬라이딩 윈도우 시간 범위 계산
    analysis_start, analysis_end, period_desc = get_sliding_window_timeframe(release_start)

    if TEST_MODE:
        analysis_start_kst = utc_to_kst(analysis_start)
        analysis_end_kst = utc_to_kst(analysis_end)
        print(f"   📊 분석 기간: {period_desc}")
        print(f"   ⏰ 분석 범위: {analysis_start_kst.strftime('%Y-%m-%d %H:%M')} ~ {analysis_end_kst.strftime('%Y-%m-%d %H:%M')} KST")

    # 현재 윈도우 데이터 분석 - 릴리즈 버전 필터링 적용!
    current_issues = collect_release_issues_with_fallback(analysis_start, analysis_end, release_version)
    current_analysis = analyze_crash_issues_with_levels(current_issues, analysis_start, analysis_end)

    # 중요 이슈 상세 분석
    critical_issues = []
    for issue in current_analysis['top_issues'][:5]:
        if issue['window_count'] >= 10:  # 윈도우 내 10건 이상만
            critical_issues.append({
                'title': format_issue_title(issue['title']),
                'level': issue['level'],
                'count': issue['window_count'],
                'users': issue['users'],
                'id': issue['id'],
                'sentry_url': f"https://sentry.io/organizations/{ORG_SLUG}/issues/{issue['id']}/"
            })

    # 권장사항 생성
    recommendations = generate_recommendations_by_level(current_analysis['levels'])

    result = {
        'release_version': release_version,
        'analysis_period': {
            'start': analysis_start.isoformat(),
            'end': analysis_end.isoformat(),
            'description': period_desc,
            'window_hours': MONITORING_PERIODS['analysis_window_hours']
        },
        'current_analysis': current_analysis,
        'risk_assessment': {
            'level': current_analysis['levels']['overall'],
            'status': get_level_status(current_analysis['levels']['overall']),
            'details': current_analysis['levels']
        },
        'critical_issues': critical_issues,
        'recommendations': recommendations,
        'analyzed_at': datetime.now(timezone.utc).isoformat()
    }

    if TEST_MODE:
        overall_level = current_analysis['levels']['overall']
        overall_status = get_level_status(overall_level)
        print(f"   🎯 전체 위험도: Level {overall_level} ({overall_status})")
        if critical_issues:
            print(f"   🔥 중요 이슈: {len(critical_issues)}개")

    return result


def get_level_status(level: int) -> str:
    """레벨에 따른 상태 텍스트 반환"""
    if level == 0:
        return "정상"
    elif level in CRASH_ALERT_LEVELS:
        return CRASH_ALERT_LEVELS[level]['status']
    else:
        return "알 수 없음"


def generate_recommendations_by_level(levels: Dict) -> List[str]:
    """레벨에 따른 권장사항 생성"""
    recommendations = []
    overall_level = levels['overall']

    if overall_level >= 5:
        recommendations.extend([
            "🚨 즉시 롤백 실행",
            "📞 전체 개발팀 긴급 소집",
            "🔍 장애 대응 프로세스 가동",
            "📢 사용자 공지 준비"
        ])
    elif overall_level >= 4:
        recommendations.extend([
            "⚠️ 롤백 검토 및 준비",
            "📞 핵심 개발팀 긴급 소집",
            "🔍 상위 크래시 이슈 우선 분석",
            "📊 사용자 영향 범위 상세 확인"
        ])
    elif overall_level >= 3:
        recommendations.extend([
            "🔧 핫픽스 준비 검토",
            "⚠️ 크래시 패턴 모니터링 강화",
            "📈 30분 후 재분석 권장",
            "👥 담당 개발자 알림"
        ])
    elif overall_level >= 2:
        recommendations.extend([
            "👀 지속적인 모니터링 강화",
            "📋 이슈 트래킹 시작",
            "📈 1시간 후 재분석"
        ])
    else:
        recommendations.extend([
            "✅ 안정적인 배포 상태",
            "📊 정기 모니터링 계속"
        ])

    # 특정 레벨별 추가 권장사항
    if levels['fatal']['level'] >= 2:
        recommendations.append("💀 Fatal 크래시 최우선 처리")

    if levels['user_impact']['level'] >= 3:
        recommendations.append("👥 사용자 영향 최소화 조치")

    if levels['single_issue']['level'] >= 4:
        recommendations.append("🎯 단일 이슈 집중 분석 필요")

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


def debug_environment_issues() -> None:
    """환경별 이슈 분포 디버깅"""
    if not TEST_MODE:
        return

    print(f"\n🔍 환경 '{ENVIRONMENT}' 이슈 분포 디버깅")

    # 최근 7일간 전체 이슈 조회 (환경 제한 없음)
    end_time = datetime.now(timezone.utc)
    start_time = end_time - timedelta(days=7)

    issues_url = f"{SENTRY_API_BASE}/projects/{ORG_SLUG}/{PROJECT_SLUG}/issues/"

    # 환경 제한 없이 조회
    params = {
        'query': f'firstSeen:>={start_time.isoformat()}',
        'limit': 50,
        'sort': 'date'
    }

    try:
        response = requests.get(issues_url, headers=HEADERS, params=params, timeout=15)

        if response.status_code == 200:
            issues = response.json()

            # 환경별 분포 계산
            env_count = {}
            level_count = {}

            for issue in issues:
                # 환경 태그 확인
                tags = issue.get('tags', [])
                env_tags = [tag['value'] for tag in tags if tag.get('key') == 'environment']

                # 레벨 확인
                level = issue.get('level', 'unknown')
                level_count[level] = level_count.get(level, 0) + 1

                if env_tags:
                    for env in env_tags:
                        env_count[env] = env_count.get(env, 0) + 1
                else:
                    env_count['(no environment)'] = env_count.get('(no environment)', 0) + 1

            print(f"   📊 최근 7일 이슈 {len(issues)}개:")
            print(f"   🌍 환경별 분포: {dict(sorted(env_count.items()))}")
            print(f"   📈 레벨별 분포: {dict(sorted(level_count.items()))}")

            if ENVIRONMENT not in env_count:
                print(f"   ⚠️ 설정된 환경 '{ENVIRONMENT}'에 해당하는 이슈가 없습니다!")
                print(f"   💡 .env 파일의 SENTRY_ENVIRONMENT 값을 확인하세요.")

        else:
            print(f"   ❌ 디버깅 조회 실패: {response.status_code}")

    except Exception as e:
        print(f"   ❌ 환경 디버깅 오류: {e}")


def test_release_version_filtering():
    """릴리즈 버전 필터링 테스트 함수"""
    if not TEST_MODE:
        return

    print(f"\n🧪 릴리즈 버전 필터링 테스트")

    import os
    test_version = os.getenv('TEST_RELEASE_VERSION', 'test-1.0.0')
    print(f"   테스트 버전: {test_version}")

    # 버전 변형 확인
    variations = get_release_version_variations(test_version)
    print(f"   시도할 버전 변형: {variations}")

    # Sentry 릴리즈 목록 확인
    available_releases = debug_sentry_releases()

    # 매칭되는 릴리즈 확인
    matching_releases = []
    for variation in variations:
        for available in available_releases:
            if variation in available or available in variation:
                matching_releases.append((variation, available))

    if matching_releases:
        print(f"   ✅ 매칭되는 릴리즈 발견:")
        for variation, available in matching_releases:
            print(f"      {variation} ↔ {available}")
    else:
        print(f"   ⚠️ 매칭되는 릴리즈를 찾을 수 없습니다.")
        print(f"   💡 Sentry에 릴리즈가 제대로 등록되었는지 확인하세요.")

    # 최근 24시간 이슈로 실제 테스트
    end_time = datetime.now(timezone.utc)
    start_time = end_time - timedelta(hours=24)

    print(f"\n📊 실제 이슈 수집 테스트:")

    # 1. 버전 필터 없이 조회
    all_issues = collect_release_issues(start_time, end_time, None)
    print(f"   전체 이슈: {len(all_issues)}개")

    # 2. 버전 필터 적용해서 조회
    filtered_issues = collect_release_issues_with_fallback(start_time, end_time, test_version)
    print(f"   필터링된 이슈: {len(filtered_issues)}개")

    # 3. 상위 이슈의 릴리즈 태그 분석
    if filtered_issues:
        debug_issue_release_tags(filtered_issues[:5], test_version)

    return len(filtered_issues)