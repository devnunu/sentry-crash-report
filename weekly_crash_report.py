"""
Sentry 주간 Android 크래시 리포트 스크립트
매주 월요일에 지난 7일간의 크래시 현황을 분석하여 Slack으로 전송
"""

import json
import os
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Tuple, List

import requests

# dotenv 지원 (로컬 환경)
try:
    from dotenv import load_dotenv
    env_path = Path('.env')
    if env_path.exists():
        load_dotenv()
        print("✅ .env 파일에서 환경변수를 로드했습니다.")
except ImportError:
    pass

# 환경 변수 확인
SENTRY_TOKEN = os.getenv('SENTRY_AUTH_TOKEN')
ORG_SLUG = os.getenv('SENTRY_ORG_SLUG')
PROJECT_SLUG = os.getenv('SENTRY_PROJECT_SLUG')
PROJECT_ID = os.getenv('SENTRY_PROJECT_ID')
SLACK_WEBHOOK = os.getenv('SLACK_WEBHOOK_URL')
DASH_BOARD_ID = os.getenv('DASH_BOARD_ID')
ENVIRONMENT = os.getenv('SENTRY_ENVIRONMENT', 'Production')

# 테스트 모드 확인
TEST_MODE = os.getenv('TEST_MODE', 'false').lower() == 'true'

# 테스트 모드일 때 디버그 디렉토리 생성
if TEST_MODE:
    DEBUG_DIR = Path('debug_output')
    DEBUG_DIR.mkdir(exist_ok=True)
    print("🧪 주간 리포트 테스트 모드 활성화")

# 환경 변수 검증
if not all([SENTRY_TOKEN, ORG_SLUG, PROJECT_SLUG, PROJECT_ID]):
    print("❌ 필수 환경변수가 설정되지 않았습니다.")
    raise ValueError("Sentry 관련 필수 환경변수를 설정해주세요.")

try:
    PROJECT_ID = int(PROJECT_ID)
except (ValueError, TypeError):
    raise ValueError("SENTRY_PROJECT_ID는 숫자여야 합니다.")

# Sentry API 설정
SENTRY_API_BASE = "https://sentry.io/api/0"
HEADERS = {
    'Authorization': f'Bearer {SENTRY_TOKEN}',
    'Content-Type': 'application/json'
}

# 한국 시간대 설정
KST = timezone(timedelta(hours=9))


def get_weekly_datetime_range():
    """지난 7일간 시간 범위 계산 (KST 기준)"""
    target_date_str = os.getenv('TARGET_WEEK_START')

    if target_date_str:
        try:
            week_start = datetime.strptime(target_date_str, '%Y-%m-%d')
            week_start = week_start.replace(tzinfo=KST)
            print(f"🎯 지정된 주간 시작일 사용: {target_date_str}")
        except ValueError:
            print(f"⚠️ 잘못된 날짜 형식: {target_date_str}. 지난 7일을 사용합니다.")
            now = datetime.now(KST)
            week_start = now - timedelta(days=7)
    else:
        now = datetime.now(KST)
        week_start = now - timedelta(days=7)
        print(f"📅 기본 주간 범위 사용 (지난 7일)")

    # 이번 주: 7일 전 00:00 ~ 어제 23:59
    this_week_start = week_start.replace(hour=0, minute=0, second=0, microsecond=0)
    this_week_end = (week_start + timedelta(days=6)).replace(hour=23, minute=59, second=59, microsecond=999999)

    # 전주: 14일 전 00:00 ~ 8일 전 23:59
    prev_week_start = this_week_start - timedelta(days=7)
    prev_week_end = this_week_start - timedelta(microseconds=1)

    # UTC로 변환
    this_week_start_utc = this_week_start.astimezone(timezone.utc)
    this_week_end_utc = this_week_end.astimezone(timezone.utc)
    prev_week_start_utc = prev_week_start.astimezone(timezone.utc)
    prev_week_end_utc = prev_week_end.astimezone(timezone.utc)

    return {
        'this_week': (this_week_start_utc, this_week_end_utc, this_week_start),
        'prev_week': (prev_week_start_utc, prev_week_end_utc, prev_week_start)
    }


def collect_weekly_issues(start_time: datetime, end_time: datetime, week_label: str) -> List[Dict]:
    """주간 이슈 수집"""
    issues_url = f"{SENTRY_API_BASE}/projects/{ORG_SLUG}/{PROJECT_SLUG}/issues/"
    all_issues = []

    start_str = start_time.isoformat()
    end_str = end_time.isoformat()

    # firstSeen 기준 이슈 수집
    cursor = None
    page = 1

    while True:
        issues_params = {
            'query': f'firstSeen:>={start_str} firstSeen:<{end_str} environment:{ENVIRONMENT}',
            'limit': 100,
            'sort': 'date',
            'environment': ENVIRONMENT
        }

        if cursor:
            issues_params['cursor'] = cursor

        if TEST_MODE:
            print(f"🔍 {week_label} firstSeen 페이지 {page} 조회...")

        try:
            response = requests.get(issues_url, headers=HEADERS, params=issues_params)
            if response.status_code != 200:
                break

            page_issues = response.json()
            if not page_issues:
                break

            all_issues.extend(page_issues)

            if TEST_MODE:
                print(f"   페이지 {page}: {len(page_issues)}개 수집 (총 {len(all_issues)}개)")

            # 다음 페이지 체크
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
                print(f"   ❌ 오류: {str(e)}")
            break

    # lastSeen 기준 이슈 추가 수집
    existing_issues_params = {
        'query': f'lastSeen:>={start_str} lastSeen:<{end_str} environment:{ENVIRONMENT}',
        'limit': 100,
        'sort': 'date',
        'environment': ENVIRONMENT
    }

    existing_cursor = None
    existing_page = 1

    while True:
        if existing_cursor:
            existing_issues_params['cursor'] = existing_cursor

        try:
            response = requests.get(issues_url, headers=HEADERS, params=existing_issues_params)
            if response.status_code != 200:
                break

            existing_issues = response.json()
            if not existing_issues:
                break

            # 중복 제거하면서 추가
            existing_issue_ids = {issue.get('id') for issue in all_issues}
            new_count = 0
            for issue in existing_issues:
                if issue.get('id') not in existing_issue_ids:
                    all_issues.append(issue)
                    new_count += 1

            if TEST_MODE and existing_page <= 2:
                print(f"   {week_label} lastSeen 페이지 {existing_page}: {new_count}개 새로 추가")

            # 다음 페이지 체크
            link_header = response.headers.get('Link', '')
            if 'rel="next"' not in link_header:
                break

            cursor_match = re.search(r'cursor=([^&>]+).*rel="next"', link_header)
            if cursor_match:
                existing_cursor = cursor_match.group(1)
                existing_page += 1
            else:
                break

        except Exception as e:
            if TEST_MODE:
                print(f"   ❌ {week_label} lastSeen 오류: {str(e)}")
            break

    return all_issues


def get_issue_events_count_accurate(issue_id: str, start_time: datetime, end_time: datetime) -> int:
    """정확한 이슈 이벤트 수 조회 (기간 내 실제 이벤트 수)"""
    events_url = f"{SENTRY_API_BASE}/issues/{issue_id}/events/"
    total_events = 0
    cursor = None
    max_pages = 5  # 최대 5페이지로 줄임 (500개 이벤트)

    for page in range(max_pages):
        params = {
            'limit': 100
        }

        if cursor:
            params['cursor'] = cursor

        try:
            response = requests.get(events_url, headers=HEADERS, params=params, timeout=10)

            if response.status_code != 200:
                if TEST_MODE:
                    print(f"        ⚠️ API 응답 오류: {response.status_code}")
                break

            events = response.json()
            if not events:
                break

            # 시간 범위 내 이벤트만 카운트
            events_in_range = 0
            for event in events:
                event_time_str = event.get('dateCreated')
                if event_time_str:
                    try:
                        event_time = datetime.fromisoformat(event_time_str.replace('Z', '+00:00'))
                        if start_time <= event_time <= end_time:
                            events_in_range += 1
                        elif event_time < start_time:
                            # 시간 범위를 벗어나면 중단
                            return total_events
                    except:
                        pass

            total_events += events_in_range

            # 해당 범위에 이벤트가 없으면 조기 중단
            if events_in_range == 0 and page > 0:
                break

            # 진행 상황 표시 (페이지별)
            if TEST_MODE and events_in_range > 0:
                print(f"        📄 페이지 {page+1}: {events_in_range}건 발견 (누적: {total_events}건)")

            # 다음 페이지 체크
            link_header = response.headers.get('Link', '')
            if 'rel="next"' not in link_header:
                break

            cursor_match = re.search(r'cursor=([^&>]+).*rel="next"', link_header)
            if cursor_match:
                cursor = cursor_match.group(1)
            else:
                break

        except requests.exceptions.Timeout:
            if TEST_MODE:
                print(f"        ⏰ {issue_id} 이벤트 조회 타임아웃 (페이지 {page+1})")
            break
        except Exception as e:
            if TEST_MODE:
                print(f"        ⚠️ {issue_id} 이벤트 조회 실패: {str(e)}")
            break

    return total_events


def calculate_weekly_crash_stats(all_issues: List[Dict], start_time: datetime, end_time: datetime, week_label: str) -> Dict:
    """주간 크래시 통계 계산 (정확한 이벤트 수 사용)"""
    # 크래시 이슈만 필터링
    crash_issues = []
    for issue in all_issues:
        level = issue.get('level', '').lower()
        if level in ['error', 'fatal']:
            crash_issues.append(issue)

    if TEST_MODE:
        print(f"📊 {week_label}: 총 {len(all_issues)}개 이슈 중 {len(crash_issues)}개 크래시 이슈")

    # 성능 최적화: 상위 50개만 정확히 처리 (API 호출 제한)
    if len(crash_issues) > 50:
        print(f"⚡ {week_label}: 크래시 이슈가 {len(crash_issues)}개로 많아서 상위 50개만 정확히 처리합니다.")
        crash_issues_sorted = sorted(crash_issues, key=lambda x: safe_int(x.get('count', 0)), reverse=True)
        crash_issues = crash_issues_sorted[:50]

    total_events = 0
    all_affected_users = set()
    processed_issues = []

    for i, issue in enumerate(crash_issues):
        issue_id = issue.get('id')
        if not issue_id:
            continue

        # 진행 상황 표시
        if (i + 1) % 5 == 0 or i == 0:
            print(f"   🔄 {week_label}: {i + 1}/{len(crash_issues)} 크래시 이슈 처리 중...")

        # 정확한 이벤트 수 조회
        event_count = get_issue_events_count_accurate(issue_id, start_time, end_time)

        if event_count > 0:
            issue['weekly_event_count'] = event_count
            total_events += event_count

            # 사용자 수 추정 (더 보수적으로)
            estimated_users = min(event_count, safe_int(issue.get('userCount', 0)))
            issue['weekly_users'] = estimated_users

            # 전체 사용자에 추가
            for user_idx in range(estimated_users):
                all_affected_users.add(f"{issue_id}_{user_idx}")

            processed_issues.append(issue)

            if TEST_MODE and i < 3:
                print(f"      ✅ {issue.get('title', '')[:30]}... : {event_count}건")

        # API 호출 간 딜레이 (rate limit 방지)
        if (i + 1) % 5 == 0:
            time.sleep(0.2)

    total_affected_users = len(all_affected_users)

    print(f"   ✅ {week_label} 완료:")
    print(f"      - 크래시 이벤트: {total_events}건")
    print(f"      - 크래시 이슈: {len(processed_issues)}개")
    print(f"      - 영향 사용자: {total_affected_users}명")

    return {
        'total_crashes': total_events,
        'total_issues': len(processed_issues),
        'affected_users': total_affected_users,
        'issues': processed_issues
    }


def collect_daily_crash_data_simple(week_start_utc: datetime) -> List[int]:
    """일간 리포트 로직을 사용한 정확한 일별 크래시 데이터 수집"""
    daily_crashes = []
    days = ['월', '화', '수', '목', '금', '토', '일']

    print(f"   📊 7일간 일별 크래시 분석 시작...")

    # 기준 시간을 KST로 변환
    week_start_kst = week_start_utc.astimezone(KST)
    print(f"   🕐 기준 시작 시간 (KST): {week_start_kst.strftime('%Y-%m-%d %H:%M:%S')}")

    # 7일간 각각 일간 리포트 로직 적용
    for day in range(7):
        # KST 기준으로 날짜 범위 계산
        day_kst_start = week_start_kst + timedelta(days=day)
        day_kst_start = day_kst_start.replace(hour=0, minute=0, second=0, microsecond=0)  # 00:00:00
        day_kst_end = day_kst_start.replace(hour=23, minute=59, second=59, microsecond=999999)  # 23:59:59

        # KST를 UTC로 변환
        day_start_utc = day_kst_start.astimezone(timezone.utc)
        day_end_utc = day_kst_end.astimezone(timezone.utc)

        day_name = days[day]

        # 상세한 시간 범위 출력
        print(f"   🔄 [{day+1}/7] {day_name}요일 분석:")
        print(f"      📅 KST: {day_kst_start.strftime('%Y-%m-%d %H:%M:%S')} ~ {day_kst_end.strftime('%Y-%m-%d %H:%M:%S')}")

        # 일간 리포트와 동일한 로직으로 해당 날짜 이슈 수집 (UTC 시간 사용)
        day_issues = collect_issues_for_date(day_start_utc, day_end_utc)

        # 크래시 이벤트 수 계산 (일간 리포트 로직)
        day_crashes = calculate_crash_stats_for_date(day_issues, day_start_utc, day_end_utc)

        daily_crashes.append(day_crashes)

        print(f"      ✅ {day_name}요일 ({day_kst_start.strftime('%m/%d')}): {day_crashes}건")
        print()  # 빈 줄 추가로 가독성 향상

        # API 호출 간 딜레이
        time.sleep(0.3)

    print(f"   📈 일별 분석 완료: {daily_crashes}")
    print(f"   📈 총합 검증: {sum(daily_crashes)}건")
    return daily_crashes


def collect_issues_for_date(start_time: datetime, end_time: datetime) -> List[Dict]:
    """특정 날짜의 모든 이슈 수집 (원래 방식으로 복원)"""

    start_str = start_time.isoformat()
    end_str = end_time.isoformat()

    issues_url = f"{SENTRY_API_BASE}/projects/{ORG_SLUG}/{PROJECT_SLUG}/issues/"
    all_issues = []

    # firstSeen 기준 이슈 수집
    cursor = None
    page = 1

    while True:
        issues_params = {
            'query': f'firstSeen:>={start_str} firstSeen:<{end_str} environment:{ENVIRONMENT}',
            'limit': 100,
            'sort': 'date',
            'environment': ENVIRONMENT
        }

        if cursor:
            issues_params['cursor'] = cursor

        try:
            response = requests.get(issues_url, headers=HEADERS, params=issues_params)

            if response.status_code != 200:
                break

            page_issues = response.json()

            if not page_issues:
                break

            all_issues.extend(page_issues)

            # 다음 페이지 체크
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
            break

    # lastSeen 기준 이슈 추가 수집
    existing_issues_params = {
        'query': f'lastSeen:>={start_str} lastSeen:<{end_str} environment:{ENVIRONMENT}',
        'limit': 100,
        'sort': 'date',
        'environment': ENVIRONMENT
    }

    existing_cursor = None
    existing_page = 1

    while True:
        if existing_cursor:
            existing_issues_params['cursor'] = existing_cursor

        try:
            response = requests.get(issues_url, headers=HEADERS, params=existing_issues_params)

            if response.status_code != 200:
                break

            existing_issues = response.json()

            if not existing_issues:
                break

            # 중복 제거하면서 추가
            existing_issue_ids = {issue.get('id') for issue in all_issues}
            new_count = 0
            for issue in existing_issues:
                if issue.get('id') not in existing_issue_ids:
                    all_issues.append(issue)
                    new_count += 1

            if TEST_MODE and existing_page <= 2:
                print(f"      lastSeen 페이지 {existing_page}: {new_count}개 새로 추가")

            # 다음 페이지 체크
            link_header = response.headers.get('Link', '')
            if 'rel="next"' not in link_header:
                break

            cursor_match = re.search(r'cursor=([^&>]+).*rel="next"', link_header)
            if cursor_match:
                existing_cursor = cursor_match.group(1)
                existing_page += 1
            else:
                break

        except Exception as e:
            if TEST_MODE:
                print(f"      ❌ lastSeen 오류: {str(e)}")
            break

    return all_issues


def calculate_crash_stats_for_date(all_issues: List[Dict], start_time: datetime, end_time: datetime) -> int:
    """특정 날짜의 크래시 통계 계산 (크래시 이슈만 필터링)"""

    # 크래시 이슈만 필터링 (error, fatal만)
    crash_issues = []
    for issue in all_issues:
        level = issue.get('level', '').lower()
        if level in ['error', 'fatal']:
            crash_issues.append(issue)

    if TEST_MODE:
        day_str = start_time.astimezone(KST).strftime('%m/%d')
        print(f"         📊 {day_str}: 총 {len(all_issues)}개 이슈 중 {len(crash_issues)}개 크래시 이슈")

    # 성능 최적화: 이슈가 많으면 제한
    if len(crash_issues) > 100:
        crash_issues_sorted = sorted(crash_issues, key=lambda x: safe_int(x.get('count', 0)), reverse=True)
        crash_issues = crash_issues_sorted[:100]

    # 크래시 이벤트 수 계산
    total_events = 0
    crash_issues_with_events = []

    for i, issue in enumerate(crash_issues):
        issue_id = issue.get('id')
        if not issue_id:
            continue

        # 진행 상황 표시
        if (i + 1) % 5 == 0 or i == 0:
            day_str = start_time.astimezone(KST).strftime('%m/%d')
            print(f"         🔄 {day_str}: {i + 1}/{len(crash_issues)} 크래시 이슈 처리 중...")

        # 이벤트 수 조회 (일간 리포트와 동일한 방식)
        event_count = get_issue_events_count_optimized(issue, issue_id, start_time, end_time)

        if event_count > 0:
            issue['event_count'] = event_count
            total_events += event_count
            crash_issues_with_events.append(issue)

            # TEST 모드에서 상세 정보 출력
            if TEST_MODE and len(crash_issues_with_events) <= 3:
                print(f"            ✅ 크래시: {issue.get('title', '')[:40]}")
                print(f"               - 이벤트: {event_count}건")

        # API 호출 간 딜레이 (rate limit 방지)
        if (i + 1) % 10 == 0:
            time.sleep(0.1)

    return total_events


def get_issue_events_count_optimized(issue: Dict, issue_id: str, start_time: datetime, end_time: datetime) -> int:
    """최적화된 이슈 이벤트 수 조회 (일간 리포트와 완전 동일)"""

    # 최적화 1: 이슈의 stats 데이터 먼저 확인 (타입 안전하게)
    try:
        # stats 데이터 구조 확인 및 안전한 처리
        if 'stats' in issue and issue['stats']:
            stats = issue['stats']

            # 24h 데이터 확인
            if '24h' in stats and stats['24h']:
                stats_24h = stats['24h']

                if TEST_MODE:
                    print(f"         🔍 {issue_id}: stats 데이터 타입 확인 - {type(stats_24h)}")
                    if isinstance(stats_24h, list) and len(stats_24h) > 0:
                        print(f"         🔍 {issue_id}: 첫 번째 항목 - {stats_24h[0]}, 타입: {type(stats_24h[0])}")

                recent_count = 0

                # 다양한 stats 형태 처리
                if isinstance(stats_24h, list):
                    for item in stats_24h:
                        try:
                            # item이 리스트인 경우: [timestamp, count]
                            if isinstance(item, list) and len(item) >= 2:
                                count_value = item[1]
                                if isinstance(count_value, (int, float)) and count_value > 0:
                                    recent_count += int(count_value)
                            # item이 딕셔너리인 경우
                            elif isinstance(item, dict):
                                for key, value in item.items():
                                    if isinstance(value, (int, float)) and value > 0:
                                        recent_count += int(value)
                            # item이 숫자인 경우
                            elif isinstance(item, (int, float)) and item > 0:
                                recent_count += int(item)
                        except (TypeError, ValueError, IndexError) as e:
                            if TEST_MODE:
                                print(f"         ⚠️ {issue_id}: stats 항목 처리 오류 - {e}, 항목: {item}")
                            continue

                elif isinstance(stats_24h, dict):
                    # stats가 딕셔너리 형태인 경우
                    for key, value in stats_24h.items():
                        try:
                            if isinstance(value, (int, float)) and value > 0:
                                recent_count += int(value)
                        except (TypeError, ValueError) as e:
                            if TEST_MODE:
                                print(f"         ⚠️ {issue_id}: stats dict 처리 오류 - {e}")
                            continue

                if recent_count > 0:
                    if TEST_MODE:
                        print(f"         📊 {issue_id}: stats에서 {recent_count}건 발견 (빠른 방법)")
                    return recent_count

        # stats가 없거나 유효하지 않으면 이슈의 기본 count 정보 활용
        total_count = issue.get('count', 0)
        if isinstance(total_count, (int, float)) and total_count > 0:
            # 최근성 추정: lastSeen이 타겟 날짜 범위 내인지 확인
            last_seen_str = issue.get('lastSeen')
            if last_seen_str:
                try:
                    last_seen = datetime.fromisoformat(last_seen_str.replace('Z', '+00:00'))
                    if start_time <= last_seen <= end_time:
                        # 대략적으로 최근 활동 기준으로 추정
                        estimated_count = min(int(total_count), 50)  # 최대 50개로 제한
                        if TEST_MODE:
                            print(f"         📊 {issue_id}: 추정 {estimated_count}건 (lastSeen 기반)")
                        return estimated_count
                except Exception as e:
                    if TEST_MODE:
                        print(f"         ⚠️ {issue_id}: lastSeen 처리 오류 - {e}")
                    pass

    except Exception as e:
        if TEST_MODE:
            print(f"         ⚠️ {issue_id} stats 전체 처리 오류: {str(e)}")
            # 디버깅을 위해 stats 구조 출력
            try:
                stats = issue.get('stats', {})
                print(f"         🔍 {issue_id}: stats 구조 - {type(stats)}: {str(stats)[:200]}...")
            except:
                print(f"         🔍 {issue_id}: stats 구조 출력 실패")

    # 최적화 2: 직접 이벤트 조회 (제한적으로)
    if TEST_MODE:
        print(f"         🔄 {issue_id}: 직접 이벤트 조회로 전환")

    return get_issue_events_count_for_date_limited(issue_id, start_time, end_time)


def get_issue_events_count_for_date_limited(issue_id: str, start_time: datetime, end_time: datetime) -> int:
    """제한적 이벤트 수 조회 (일간 리포트와 완전 동일)"""

    events_url = f"{SENTRY_API_BASE}/issues/{issue_id}/events/"
    all_events = []
    max_pages = 3  # 최대 3페이지만 조회 (300개 이벤트)
    page = 0
    cursor = None

    while page < max_pages:
        params = {
            'limit': 100
        }

        if cursor:
            params['cursor'] = cursor

        try:
            response = requests.get(events_url, headers=HEADERS, params=params, timeout=10)  # 타임아웃 단축

            if response.status_code != 200:
                break

            events = response.json()

            if not events:
                break

            # 시간 범위 내 이벤트만 필터링
            found_in_range = False
            for event in events:
                event_time_str = event.get('dateCreated')
                if event_time_str:
                    try:
                        event_time = datetime.fromisoformat(event_time_str.replace('Z', '+00:00'))
                        if start_time <= event_time <= end_time:
                            all_events.append(event)
                            found_in_range = True
                        elif event_time < start_time:
                            # 시간 범위를 벗어나면 중단
                            return len(all_events)
                    except:
                        pass

            # 해당 범위에 이벤트가 없으면 조기 중단
            if not found_in_range and page > 0:
                break

            # 다음 페이지 체크
            link_header = response.headers.get('Link', '')
            if 'rel="next"' not in link_header:
                break

            cursor_match = re.search(r'cursor=([^&>]+).*rel="next"', link_header)
            if cursor_match:
                cursor = cursor_match.group(1)
                page += 1
            else:
                break

        except requests.exceptions.Timeout:
            if TEST_MODE:
                print(f"         ⏰ {issue_id} 이벤트 조회 타임아웃")
            break
        except Exception as e:
            if TEST_MODE:
                print(f"         ⚠️ {issue_id} 이벤트 조회 실패: {str(e)}")
            break

    return len(all_events)


def get_issue_events_count_for_date_optimized(issue_id: str, start_time: datetime, end_time: datetime) -> int:
    """특정 이슈의 특정 날짜 이벤트 수 조회 (일간 리포트 로직 최적화)"""

    events_url = f"{SENTRY_API_BASE}/issues/{issue_id}/events/"
    all_events = []
    cursor = None
    max_pages = 3  # 최대 3페이지만 조회

    page = 0
    while page < max_pages:
        params = {
            'limit': 100
        }

        if cursor:
            params['cursor'] = cursor

        try:
            response = requests.get(events_url, headers=HEADERS, params=params, timeout=10)

            if response.status_code != 200:
                break

            events = response.json()

            if not events:
                break

            # 시간 범위 내 이벤트만 필터링
            found_in_range = False
            for event in events:
                event_time_str = event.get('dateCreated')
                if event_time_str:
                    try:
                        event_time = datetime.fromisoformat(event_time_str.replace('Z', '+00:00'))
                        if start_time <= event_time <= end_time:
                            all_events.append(event)
                            found_in_range = True
                        elif event_time < start_time:
                            # 시간 범위를 벗어나면 중단
                            return len(all_events)
                    except:
                        pass

            # 해당 범위에 이벤트가 없으면 조기 중단
            if not found_in_range and page > 0:
                break

            # 다음 페이지 체크
            link_header = response.headers.get('Link', '')
            if 'rel="next"' not in link_header:
                break

            cursor_match = re.search(r'cursor=([^&>]+).*rel="next"', link_header)
            if cursor_match:
                cursor = cursor_match.group(1)
                page += 1
            else:
                break

        except requests.exceptions.Timeout:
            break
        except Exception as e:
            break

    return len(all_events)


def detect_anomalies_simple(this_week_daily: List[int]) -> List[str]:
    """간단한 이상 징후 탐지 (전주 비교 제거)"""
    anomalies = []

    if not this_week_daily or len(this_week_daily) < 7:
        return anomalies

    avg_crashes = sum(this_week_daily) / len(this_week_daily)
    days = ['월', '화', '수', '목', '금', '토', '일']

    for i, crashes in enumerate(this_week_daily):
        day_name = days[i]

        # 급증 감지 (평균 대비 100% 이상)
        if avg_crashes > 0 and crashes > avg_crashes * 2:
            anomalies.append(f"{day_name}요일 급증: {crashes}건 (이번주 평균 {avg_crashes:.0f}건 대비 +{((crashes/avg_crashes-1)*100):.0f}%)")

        # 임계점 돌파 (일 100건 초과)
        if crashes > 100:
            anomalies.append(f"{day_name}요일 임계점 돌파: {crashes}건 (기준: 100건)")

    # 연속 증가 패턴 감지
    consecutive_increases = 0
    for i in range(1, len(this_week_daily)):
        if this_week_daily[i] > this_week_daily[i-1]:
            consecutive_increases += 1
        else:
            if consecutive_increases >= 2:  # 3일 이상 연속 증가
                end_day = days[i-1]
                start_day = days[i-consecutive_increases-1]
                start_count = this_week_daily[i-consecutive_increases-1]
                end_count = this_week_daily[i-1]
                anomalies.append(f"{start_day}-{end_day} 연속 증가: {start_count}건 → {end_count}건 ({consecutive_increases+1}일간)")
            consecutive_increases = 0

    # 마지막 체크
    if consecutive_increases >= 2:
        end_day = days[-1]
        start_day = days[-consecutive_increases-2]
        start_count = this_week_daily[-consecutive_increases-2]
        end_count = this_week_daily[-1]
        anomalies.append(f"{start_day}-{end_day} 연속 증가: {start_count}건 → {end_count}건 ({consecutive_increases+1}일간)")

    return anomalies


def analyze_issue_lifecycle_improved(this_week_issues: List[Dict], prev_week_issues: List[Dict],
                                   this_week_start: datetime) -> Dict:
    """개선된 이슈 생명주기 분석 (진짜 신규 이슈 판별)"""
    # 이슈를 ID로 매핑
    this_week_map = {issue['id']: issue for issue in this_week_issues}
    prev_week_map = {issue['id']: issue for issue in prev_week_issues}

    this_week_ids = set(this_week_map.keys())
    prev_week_ids = set(prev_week_map.keys())

    # 진짜 신규 이슈 (firstSeen이 이번 주 범위 내)
    new_issues = []
    for issue_id in this_week_ids:
        issue = this_week_map[issue_id]
        first_seen_str = issue.get('firstSeen')

        if first_seen_str:
            try:
                first_seen = datetime.fromisoformat(first_seen_str.replace('Z', '+00:00'))
                # 이번 주에 처음 발생한 이슈만 신규로 분류
                if first_seen >= this_week_start.astimezone(timezone.utc):
                    count = issue.get('weekly_event_count', 0)
                    if count > 0:
                        new_issues.append({
                            'issue': issue,
                            'count': count,
                            'first_seen': first_seen
                        })
            except:
                pass

    new_issues.sort(key=lambda x: x['count'], reverse=True)

    # 악화된 이슈 (전주에도 있었고 이번주에도 있으면서 50% 이상 증가)
    worsened_issues = []
    for issue_id in this_week_ids & prev_week_ids:
        this_count = this_week_map[issue_id].get('weekly_event_count', 0)
        prev_count = prev_week_map[issue_id].get('weekly_event_count', 0)

        if prev_count > 0 and this_count > prev_count * 1.5:  # 50% 이상 증가
            increase_rate = ((this_count - prev_count) / prev_count) * 100
            worsened_issues.append({
                'issue': this_week_map[issue_id],
                'this_count': this_count,
                'prev_count': prev_count,
                'increase_rate': increase_rate
            })
    worsened_issues.sort(key=lambda x: x['increase_rate'], reverse=True)

    # 개선된 이슈
    improved_issues = []
    for issue_id in this_week_ids & prev_week_ids:
        this_count = this_week_map[issue_id].get('weekly_event_count', 0)
        prev_count = prev_week_map[issue_id].get('weekly_event_count', 0)

        if prev_count > 0 and this_count < prev_count * 0.5:  # 50% 이상 감소
            decrease_rate = ((prev_count - this_count) / prev_count) * 100
            improved_issues.append({
                'issue': this_week_map[issue_id],
                'this_count': this_count,
                'prev_count': prev_count,
                'decrease_rate': decrease_rate
            })
    improved_issues.sort(key=lambda x: x['decrease_rate'], reverse=True)

    # 해결된 이슈
    resolved_issues = []
    for issue_id in prev_week_ids - this_week_ids:
        prev_issue = prev_week_map[issue_id]
        prev_count = prev_issue.get('weekly_event_count', 0)
        if prev_count >= 10:  # 전주에 10건 이상이었던 이슈만
            resolved_issues.append({
                'issue': prev_issue,
                'prev_count': prev_count
            })
    resolved_issues.sort(key=lambda x: x['prev_count'], reverse=True)

    return {
        'new': new_issues[:5],
        'worsened': worsened_issues[:5],
        'improved': improved_issues[:5],
        'resolved': resolved_issues[:5]
    }


def get_weekly_crash_free_rate():
    """주간 Crash-Free Rate 조회"""
    sessions_url = f"{SENTRY_API_BASE}/organizations/{ORG_SLUG}/sessions/"

    end_time = datetime.now(timezone.utc)
    start_time = end_time - timedelta(days=7)

    params = {
        'field': ['crash_free_rate(session)'],
        'start': start_time.isoformat(),
        'end': end_time.isoformat(),
        'project': [PROJECT_ID],
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

    except Exception as e:
        if TEST_MODE:
            print(f"   ❌ 주간 Crash-Free Rate 조회 오류: {str(e)}")

    return "N/A"


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


def format_issue_title(title: str, max_length: int = 40) -> str:
    """이슈 제목 포맷팅"""
    if len(title) > max_length:
        title = title[:max_length - 3] + "..."

    # Slack 특수 문자 처리
    title = title.replace('*', '').replace('_', '').replace('`', '')
    return title


def format_weekly_slack_message(this_week_stats: Dict, prev_week_stats: Dict, lifecycle: Dict,
                                anomalies: List[str], crash_free_rate: str, week_info: Dict,
                                this_week_daily: List[int]) -> Dict:
    """주간 Slack 메시지 포맷팅 (요일별 크래시 정보 포함)"""

    this_week_start_kst = week_info['this_week'][2]
    this_week_end_kst = this_week_start_kst + timedelta(days=6)

    week_range = f"{this_week_start_kst.strftime('%Y년 %m월 %d일')} ~ {this_week_end_kst.strftime('%m월 %d일')}"

    # 전주 대비 변화 계산
    current = this_week_stats['total_crashes']
    previous = prev_week_stats['total_crashes']

    change_text = ""
    if previous == 0 and current == 0:
        change_text = " (변화 없음 ➡️)"
        status_color = "good"
        main_emoji = "✨"
        status_text = "안정적"
    elif previous == 0:
        change_text = " (신규 발생 🚨)"
        status_color = "danger"
        main_emoji = "🚨"
        status_text = "주의 필요"
    elif current == 0:
        change_text = " (완전 해결 🎉)"
        status_color = "good"
        main_emoji = "🎉"
        status_text = "완벽!"
    else:
        change_count = current - previous
        if change_count > 0:
            change_text = f" (전주 대비 +{change_count}건 📈)"
            status_color = "warning" if change_count < 100 else "danger"
            main_emoji = "⚠️" if change_count < 100 else "🚨"
            status_text = "증가" if change_count < 100 else "급증"
        elif change_count < 0:
            change_text = f" (전주 대비 {change_count}건 📉)"
            status_color = "good"
            main_emoji = "✅"
            status_text = "개선"
        else:
            change_text = " (전주와 동일 ➡️)"
            status_color = "good"
            main_emoji = "➡️"
            status_text = "안정적"

    # 일평균 계산
    daily_avg = current // 7 if current > 0 else 0

    # 요일별 크래시 현황 텍스트 생성 (담백하게 숫자만)
    days = ['월', '화', '수', '목', '금', '토', '일']
    daily_text = ""

    for i, (day, count) in enumerate(zip(days, this_week_daily)):
        daily_text += f"{day} {count}건 "

    test_indicator = " [테스트]" if TEST_MODE else ""

    # 기본 블록들
    blocks = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"Android 주간 크래시 리포트{test_indicator}",
                "emoji": True
            }
        },
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": f"📅 {week_range} | 🌍 {ENVIRONMENT} | 상태: {main_emoji} {status_text}"
                }
            ]
        },
        {
            "type": "divider"
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*📊 주요 지표*"
            }
        },
        {
            "type": "section",
            "fields": [
                {
                    "type": "mrkdwn",
                    "text": f"*주간 총 크래시*\n{current:,}건 (일평균 {daily_avg}건){change_text}"
                },
                {
                    "type": "mrkdwn",
                    "text": f"*영향받은 사용자*\n{this_week_stats['affected_users']:,}명"
                },
                {
                    "type": "mrkdwn",
                    "text": f"*크래시 이슈 종류*\n{this_week_stats['total_issues']}개"
                },
                {
                    "type": "mrkdwn",
                    "text": f"*주간 Crash-Free Rate*\n{crash_free_rate}"
                }
            ]
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*📈 요일별 크래시 현황*\n{daily_text.strip()}"
            }
        }
    ]

    # 이상 징후 섹션 (조건부)
    if anomalies:
        blocks.extend([
            {
                "type": "divider"
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*⚠️ 이번 주 이상 징후 감지*\n" + "\n".join([f"• {anomaly}" for anomaly in anomalies[:3]])
                }
            }
        ])

    # 이슈 생명주기 섹션
    lifecycle_text = ""

    if lifecycle['new']:
        lifecycle_text += f"🆕 *신규 발생 ({len(lifecycle['new'])}개)*\n"
        for i, item in enumerate(lifecycle['new'][:3], 1):
            title = format_issue_title(item['issue'].get('title', 'Unknown'))
            count = item['count']
            first_seen = item.get('first_seen')
            if first_seen:
                first_seen_kst = first_seen.astimezone(KST)
                date_str = first_seen_kst.strftime('%m/%d')
                lifecycle_text += f"  {i}. {title} - {count}건 ({date_str} 첫 발생)\n"
            else:
                lifecycle_text += f"  {i}. {title} - {count}건\n"
        lifecycle_text += "\n"

    if lifecycle['worsened']:
        lifecycle_text += f"⚠️ *악화 ({len(lifecycle['worsened'])}개)*\n"
        for i, item in enumerate(lifecycle['worsened'][:2], 1):
            title = format_issue_title(item['issue'].get('title', 'Unknown'))
            rate = item['increase_rate']
            lifecycle_text += f"  {i}. {title} +{rate:.0f}% ({item['prev_count']}→{item['this_count']}건)\n"
        lifecycle_text += "\n"

    if lifecycle['improved']:
        lifecycle_text += f"✅ *개선 ({len(lifecycle['improved'])}개)*\n"
        for i, item in enumerate(lifecycle['improved'][:2], 1):
            title = format_issue_title(item['issue'].get('title', 'Unknown'))
            rate = item['decrease_rate']
            lifecycle_text += f"  {i}. {title} -{rate:.0f}% ({item['prev_count']}→{item['this_count']}건)\n"
        lifecycle_text += "\n"

    if lifecycle['resolved']:
        lifecycle_text += f"🎉 *해결 완료 ({len(lifecycle['resolved'])}개)*\n"
        for i, item in enumerate(lifecycle['resolved'][:2], 1):
            title = format_issue_title(item['issue'].get('title', 'Unknown'))
            prev_count = item['prev_count']
            lifecycle_text += f"  {i}. {title} (전주 {prev_count}건 → 해결)\n"

    if not lifecycle_text:
        lifecycle_text = "이번 주는 특별한 변화가 없었습니다."

    blocks.extend([
        {
            "type": "divider"
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"*🔄 이슈 생명주기 분석*\n{lifecycle_text}"
            }
        }
    ])

    # 대시보드 링크
    dashboard_url = f"https://finda-b2c.sentry.io/dashboard/{DASH_BOARD_ID}" if DASH_BOARD_ID else "https://finda-b2c.sentry.io/dashboards"
    button_text = "Sentry 대시보드 열기" if DASH_BOARD_ID else "Sentry 대시보드 목록 열기"

    blocks.extend([
        {
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {
                        "type": "plain_text",
                        "text": button_text,
                        "emoji": True
                    },
                    "url": dashboard_url,
                    "style": "primary"
                }
            ]
        },
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": f"_{'로컬 테스트' if TEST_MODE else 'GitHub Actions'}에서 생성됨_"
                }
            ]
        }
    ])

    return {
        "attachments": [
            {
                "color": status_color,
                "blocks": blocks
            }
        ]
    }


def send_to_slack(message: Dict) -> bool:
    """Slack으로 메시지 전송"""
    if not SLACK_WEBHOOK:
        print("⚠️  SLACK_WEBHOOK_URL이 설정되지 않아 Slack 전송을 건너뜁니다.")
        return True

    if TEST_MODE:
        print("🔍 테스트 모드 - 주간 Slack 메시지 내용:")
        print(json.dumps(message, indent=2, ensure_ascii=False))
        print("\n💡 실제 전송하려면 TEST_MODE=false로 설정하세요.")
        return True

    try:
        response = requests.post(SLACK_WEBHOOK, json=message)

        if response.status_code == 200:
            print("✅ 주간 Slack 메시지 전송 성공")
            return True
        else:
            print(f"❌ 주간 Slack 메시지 전송 실패: {response.status_code}")
            print(f"Response: {response.text}")
            return False
    except Exception as e:
        print(f"❌ 주간 Slack 전송 중 오류 발생: {str(e)}")
        return False


def main():
    """메인 실행 함수"""
    try:
        print("🚀 주간 크래시 리포트 생성 시작...")

        if TEST_MODE:
            print("🧪 주간 리포트 테스트 모드로 실행 중입니다.")

        # 주간 날짜 범위 계산
        week_info = get_weekly_datetime_range()
        this_week_start_utc, this_week_end_utc, this_week_start_kst = week_info['this_week']
        prev_week_start_utc, prev_week_end_utc, prev_week_start_kst = week_info['prev_week']

        this_week_str = this_week_start_kst.strftime('%Y-%m-%d')
        prev_week_str = prev_week_start_kst.strftime('%Y-%m-%d')

        print(f"📅 이번 주: {this_week_str} ~ {(this_week_start_kst + timedelta(days=6)).strftime('%Y-%m-%d')} (KST)")
        print(f"📅 전주: {prev_week_str} ~ {(prev_week_start_kst + timedelta(days=6)).strftime('%Y-%m-%d')} (KST)")

        # Sentry 연결 테스트 (TEST_MODE일 때만)
        if TEST_MODE:
            print("\n🔍 Sentry 연결 테스트...")
            test_url = f"{SENTRY_API_BASE}/projects/{ORG_SLUG}/{PROJECT_SLUG}/"
            test_response = requests.get(test_url, headers=HEADERS)

            if test_response.status_code == 200:
                project_info = test_response.json()
                print(f"✅ Sentry 연결 성공: {project_info.get('name')} ({project_info.get('platform')})")
            else:
                print(f"❌ Sentry 연결 실패: {test_response.status_code}")
                return

        # 이번 주 데이터 수집
        print("\n📊 이번 주 Sentry 데이터 수집 중...")
        this_week_issues = collect_weekly_issues(this_week_start_utc, this_week_end_utc, "이번주")
        this_week_stats = calculate_weekly_crash_stats(this_week_issues, this_week_start_utc, this_week_end_utc, "이번주")

        # 전주 데이터 수집
        print("\n📊 전주 Sentry 데이터 수집 중...")
        prev_week_issues = collect_weekly_issues(prev_week_start_utc, prev_week_end_utc, "전주")
        prev_week_stats = calculate_weekly_crash_stats(prev_week_issues, prev_week_start_utc, prev_week_end_utc, "전주")

        print(f"\n📈 수집 결과:")
        print(f"  - 이번 주 크래시: {this_week_stats['total_crashes']}건")
        print(f"  - 전주 크래시: {prev_week_stats['total_crashes']}건")
        print(f"  - 이번 주 이슈: {this_week_stats['total_issues']}개")
        print(f"  - 이번 주 영향 사용자: {this_week_stats['affected_users']}명")

        # 이상 징후 탐지 (일간 리포트 로직 사용)
        print("\n🔍 일별 크래시 데이터 수집 및 이상 징후 탐지 중...")
        this_week_daily = collect_daily_crash_data_simple(this_week_start_utc)
        anomalies = detect_anomalies_simple(this_week_daily)

        print(f"📊 이번주 일별 크래시: {this_week_daily}")

        if anomalies:
            print(f"⚠️ {len(anomalies)}개 이상 징후 감지:")
            for anomaly in anomalies:
                print(f"  - {anomaly}")
        else:
            print("✅ 이상 징후 없음")

        # 이슈 생명주기 분석 (개선된 버전)
        print("\n🔄 이슈 생명주기 분석 중...")
        lifecycle = analyze_issue_lifecycle_improved(this_week_stats['issues'], prev_week_stats['issues'], this_week_start_kst)

        print(f"  - 진짜 신규 이슈: {len(lifecycle['new'])}개")
        print(f"  - 악화 이슈: {len(lifecycle['worsened'])}개")
        print(f"  - 개선 이슈: {len(lifecycle['improved'])}개")
        print(f"  - 해결 이슈: {len(lifecycle['resolved'])}개")

        # 주간 Crash-Free Rate 조회
        print("\n📊 주간 Crash-Free Rate 조회 중...")
        crash_free_rate = get_weekly_crash_free_rate()
        print(f"  - 주간 Crash-Free Rate: {crash_free_rate}")

        # 슬랙 메시지 생성
        print("\n📝 주간 리포트 메시지 생성 중...")
        message = format_weekly_slack_message(
            this_week_stats, prev_week_stats, lifecycle,
            anomalies, crash_free_rate, week_info,
            this_week_daily
        )

        # Slack 전송
        print("\n📤 Slack으로 전송 중...")
        success = send_to_slack(message)

        if success:
            print("\n🎉 주간 크래시 리포트 전송 완료!")

            # 심각한 상황 알림
            if this_week_stats['total_crashes'] > 500:
                print("⚠️ 주간 크래시가 500건을 초과했습니다. 즉시 확인이 필요합니다!")
            elif anomalies:
                print("⚠️ 이상 징후가 감지되었습니다. 상세 분석을 권장합니다.")
        else:
            print("\n❌ 주간 리포트 전송 실패")
            exit(1)

    except Exception as e:
        print(f"\n💥 주간 리포트 생성 오류: {str(e)}")

        if TEST_MODE:
            import traceback
            print("\n상세 오류 정보:")
            traceback.print_exc()

        # 오류 알림도 Slack으로 전송
        if SLACK_WEBHOOK and not TEST_MODE:
            error_message = {
                "text": f"🚨 주간 크래시 리포트 생성 오류: {str(e)}",
                "blocks": [
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"*🚨 주간 크래시 리포트 생성 오류*\n\n"
                                    f"• 오류: `{str(e)}`\n"
                                    f"• 시간: {datetime.now(KST).strftime('%Y-%m-%d %H:%M:%S')} KST\n"
                                    f"• 환경: {'로컬 테스트' if TEST_MODE else 'GitHub Actions'}"
                        }
                    }
                ]
            }

            if not TEST_MODE:
                error_message["blocks"][0]["text"]["text"] += f"\n• 저장소: `{os.getenv('GITHUB_REPOSITORY', 'unknown')}`"
                error_message["blocks"].append({
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {
                                "type": "plain_text",
                                "text": "GitHub Actions 로그 확인"
                            },
                            "url": f"https://github.com/{os.getenv('GITHUB_REPOSITORY', '')}/actions"
                        }
                    ]
                })

            send_to_slack(error_message)

        exit(1)


if __name__ == "__main__":
    main()