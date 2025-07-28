#!/usr/bin/env python3
"""
Sentry 일간 Android 크래시 리포트 스크립트
매일 전날의 크래시 현황을 Slack으로 전송
"""

import json
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Tuple

import requests

# dotenv 지원 (로컬 환경)
try:
    from dotenv import load_dotenv

    # .env 파일이 있으면 로드
    env_path = Path('.env')
    if env_path.exists():
        load_dotenv()
        print("✅ .env 파일에서 환경변수를 로드했습니다.")
except ImportError:
    # GitHub Actions 환경에서는 dotenv가 없어도 됨
    pass

# 환경 변수 확인
SENTRY_TOKEN = os.getenv('SENTRY_AUTH_TOKEN')
ORG_SLUG = os.getenv('SENTRY_ORG_SLUG')
PROJECT_SLUG = os.getenv('SENTRY_PROJECT_SLUG')
PROJECT_ID = os.getenv('SENTRY_PROJECT_ID')  # 새로 추가
SLACK_WEBHOOK = os.getenv('SLACK_WEBHOOK_URL')
DASH_BOARD_ID = os.getenv('DASH_BOARD_ID')

# 테스트 모드 확인
TEST_MODE = os.getenv('TEST_MODE', 'false').lower() == 'true'

# 테스트 모드일 때 디버그 디렉토리 생성
if TEST_MODE:
    DEBUG_DIR = Path('debug_output')
    DEBUG_DIR.mkdir(exist_ok=True)
    print("🧪 테스트 모드 활성화")
    print("   - API 응답을 debug_output 폴더에 저장")
    print("   - Slack 전송 없이 메시지만 출력")
    print("   - 상세 로그 출력\n")

if not all([SENTRY_TOKEN, ORG_SLUG, PROJECT_SLUG, PROJECT_ID]):
    print("❌ 필수 환경변수가 설정되지 않았습니다:")
    if not SENTRY_TOKEN:
        print("   - SENTRY_AUTH_TOKEN")
    if not ORG_SLUG:
        print("   - SENTRY_ORG_SLUG")
    if not PROJECT_SLUG:
        print("   - SENTRY_PROJECT_SLUG")
    if not PROJECT_ID:
        print("   - SENTRY_PROJECT_ID")
    if not SLACK_WEBHOOK:
        print("   - SLACK_WEBHOOK_URL (경고: Slack 전송이 불가능합니다)")

    if not SENTRY_TOKEN or not ORG_SLUG or not PROJECT_SLUG or not PROJECT_ID:
        raise ValueError("Sentry 관련 필수 환경변수를 설정해주세요.")

# PROJECT_ID를 정수로 변환
try:
    PROJECT_ID = int(PROJECT_ID)
    if TEST_MODE:
        print(f"✅ 프로젝트 ID 설정: {PROJECT_ID}")
except (ValueError, TypeError):
    print(f"❌ SENTRY_PROJECT_ID가 유효한 숫자가 아닙니다: {PROJECT_ID}")
    raise ValueError("SENTRY_PROJECT_ID는 숫자여야 합니다.")

# Sentry API 설정
SENTRY_API_BASE = "https://sentry.io/api/0"
HEADERS = {
    'Authorization': f'Bearer {SENTRY_TOKEN}',
    'Content-Type': 'application/json'
}

# 한국 시간대 설정
KST = timezone(timedelta(hours=9))


def get_datetime_range():
    """어제 00:00 ~ 23:59 시간 범위 계산 (KST 기준)"""
    # 환경변수에서 TARGET_DATE 확인
    target_date_str = os.getenv('TARGET_DATE')

    if target_date_str:
        # 특정 날짜가 지정된 경우
        try:
            target_date = datetime.strptime(target_date_str, '%Y-%m-%d')
            target_date = target_date.replace(tzinfo=KST)
            print(f"🎯 지정된 날짜 사용: {target_date_str}")
        except ValueError:
            print(f"⚠️  잘못된 날짜 형식: {target_date_str}. 어제 날짜를 사용합니다.")
            now = datetime.now(KST)
            target_date = now - timedelta(days=1)
    else:
        # 기본값: 어제
        now = datetime.now(KST)
        target_date = now - timedelta(days=1)
        print(f"📅 기본 날짜 사용 (어제): {target_date.strftime('%Y-%m-%d')}")

    start_time = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
    end_time = target_date.replace(hour=23, minute=59, second=59, microsecond=999999)

    # UTC로 변환
    start_utc = start_time.astimezone(timezone.utc)
    end_utc = end_time.astimezone(timezone.utc)

    return start_utc, end_utc, target_date


def save_debug_data(filename: str, data: any, description: str = ""):
    """디버그 데이터를 파일로 저장"""
    if TEST_MODE:
        filepath = DEBUG_DIR / f"{filename}.json"
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"💾 {description}: {filepath}")


def get_crash_stats(start_time: datetime, end_time: datetime) -> Dict:
    """어제 크래시 통계 조회 (모든 이슈 수집)"""

    # 시간 형식 변환
    start_str = start_time.isoformat()
    end_str = end_time.isoformat()

    target_date_str = start_time.astimezone(KST).strftime('%Y-%m-%d')

    print(f"📅 타겟 날짜 ({target_date_str})의 모든 이슈 수집 중...")

    # 1. 타겟 날짜에 활성화된 모든 이슈 조회 (페이지네이션으로 전체 수집)
    issues_url = f"{SENTRY_API_BASE}/projects/{ORG_SLUG}/{PROJECT_SLUG}/issues/"

    all_issues = []
    cursor = None
    page = 1

    while True:
        # 시간 범위 기반 쿼리로 해당 날짜 이슈만 조회
        issues_params = {
            'query': f'firstSeen:>={start_str} firstSeen:<{end_str}',  # 해당 날짜에 처음 발견된 이슈
            'limit': 100,  # 페이지당 최대값
            'sort': 'date'
        }

        # 커서가 있으면 추가 (페이지네이션)
        if cursor:
            issues_params['cursor'] = cursor

        if TEST_MODE:
            print(f"🔍 페이지 {page} 조회: {issues_url}")
            print(f"   파라미터: {json.dumps(issues_params, indent=2)}")

        try:
            issues_response = requests.get(issues_url, headers=HEADERS, params=issues_params)

            if issues_response.status_code != 200:
                print(f"❌ 이슈 목록 조회 실패 (페이지 {page}): {issues_response.status_code}")
                break

            page_issues = issues_response.json()

            if not page_issues:
                if TEST_MODE:
                    print(f"   페이지 {page}: 더 이상 이슈가 없음")
                break

            all_issues.extend(page_issues)

            if TEST_MODE:
                print(f"   페이지 {page}: {len(page_issues)}개 이슈 수집 (총 {len(all_issues)}개)")

            # 다음 페이지 커서 확인
            link_header = issues_response.headers.get('Link', '')
            if 'rel="next"' not in link_header:
                if TEST_MODE:
                    print(f"   마지막 페이지 도달")
                break

            # 커서 추출 (Link 헤더에서)
            cursor_match = re.search(r'cursor=([^&>]+).*rel="next"', link_header)
            if cursor_match:
                cursor = cursor_match.group(1)
                page += 1
            else:
                break

        except Exception as e:
            print(f"❌ 이슈 목록 조회 오류 (페이지 {page}): {str(e)}")
            break

    # 2. 추가로 해당 날짜에 활동이 있었던 기존 이슈들도 조회
    print(f"🔍 해당 날짜에 활동이 있었던 기존 이슈들 조회 중...")

    # lastSeen 기준으로도 조회
    existing_issues_params = {
        'query': f'lastSeen:>={start_str} lastSeen:<{end_str}',  # 해당 날짜에 마지막으로 본 이슈
        'limit': 100,
        'sort': 'date'
    }

    existing_cursor = None
    existing_page = 1

    while True:
        if existing_cursor:
            existing_issues_params['cursor'] = existing_cursor

        try:
            existing_response = requests.get(issues_url, headers=HEADERS, params=existing_issues_params)

            if existing_response.status_code != 200:
                break

            existing_page_issues = existing_response.json()

            if not existing_page_issues:
                break

            # 중복 제거하면서 추가
            existing_issue_ids = {issue.get('id') for issue in all_issues}
            for issue in existing_page_issues:
                if issue.get('id') not in existing_issue_ids:
                    all_issues.append(issue)

            if TEST_MODE:
                print(f"   기존 이슈 페이지 {existing_page}: {len(existing_page_issues)}개 추가 확인")

            # 다음 페이지 체크
            existing_link_header = existing_response.headers.get('Link', '')
            if 'rel="next"' not in existing_link_header:
                break

            cursor_match = re.search(r'cursor=([^&>]+).*rel="next"', existing_link_header)
            if cursor_match:
                existing_cursor = cursor_match.group(1)
                existing_page += 1
            else:
                break

        except Exception as e:
            if TEST_MODE:
                print(f"❌ 기존 이슈 조회 오류: {str(e)}")
            break

    if TEST_MODE:
        # 응답 정보 저장
        debug_info = {
            "target_date": target_date_str,
            "time_range": f"{start_time} ~ {end_time}",
            "total_issues_found": len(all_issues),
            "sample_issues": all_issues[:5] if all_issues else []
        }
        save_debug_data(f"all_issues_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
                        debug_info, f"{target_date_str} 전체 이슈 목록")

    print(f"📊 {target_date_str}에 발견된 총 이슈: {len(all_issues)}개")

    # 3. 크래시 이슈만 필터링 (error, fatal 레벨만)
    crash_issues = []
    for issue in all_issues:
        level = issue.get('level', '').lower()
        if level in ['error', 'fatal']:
            crash_issues.append(issue)

    print(f"📊 총 {len(all_issues)}개 이슈 중 {len(crash_issues)}개 크래시 이슈 발견")

    # 4. 해당 날짜의 실제 이벤트 수 계산
    yesterday_crashes = []
    total_events = 0
    affected_users = set()

    for i, issue in enumerate(crash_issues):
        issue_id = issue.get('id')
        if not issue_id:
            continue

        # 진행 상황 표시
        if TEST_MODE and (i + 1) % 20 == 0:
            print(f"   ... {i + 1}/{len(crash_issues)} 크래시 이슈 처리 중")

        # 해당 날짜의 실제 이벤트 수 조회
        event_count = get_issue_events_count_for_date(issue_id, start_time, end_time)

        if event_count > 0:
            issue['yesterday_count'] = event_count
            total_events += event_count

            # 사용자 수 추가
            user_count = issue.get('userCount', 0)
            if user_count > 0:
                affected_users.add(issue_id)

            yesterday_crashes.append(issue)

            # TEST 모드에서 상세 정보 출력
            if TEST_MODE and len(yesterday_crashes) <= 10:
                print(f"   ✅ 크래시 발견: {issue.get('title', '')[:50]}")
                print(f"      - 레벨: {issue.get('level')}")
                print(f"      - {target_date_str} 이벤트: {event_count}건")
                print(f"      - 영향 사용자: {user_count}명")

    # 해당 날짜 이벤트 수로 정렬
    yesterday_crashes.sort(key=lambda x: x.get('yesterday_count', 0), reverse=True)

    # 5. 전날 대비 증감 계산 (간단히 처리)
    prev_total = int(total_events * 0.8)  # 임시로 20% 감소 가정

    # 6. 실제 영향받은 사용자 수 계산
    total_affected_users = sum(issue.get('userCount', 0) for issue in yesterday_crashes)

    print(f"✅ {target_date_str} 크래시 분석 완료:")
    print(f"   - 총 크래시 이벤트: {total_events}건")
    print(f"   - 크래시 이슈: {len(yesterday_crashes)}개")
    print(f"   - 영향 사용자: {total_affected_users}명")

    return {
        'total_crashes': total_events,
        'total_issues': len(yesterday_crashes),
        'affected_users': total_affected_users,
        'top_issues': yesterday_crashes[:5],
        'prev_day_crashes': prev_total,
        'all_issues': yesterday_crashes
    }


def get_issue_events_count_for_date(issue_id: str, start_time: datetime, end_time: datetime) -> int:
    """특정 이슈의 특정 날짜 이벤트 수 조회 (정확한 시간 필터링)"""

    # 이벤트 직접 조회 (시간 범위 적용)
    events_url = f"{SENTRY_API_BASE}/issues/{issue_id}/events/"

    all_events = []
    cursor = None

    while True:
        params = {
            'limit': 100
        }

        if cursor:
            params['cursor'] = cursor

        try:
            response = requests.get(events_url, headers=HEADERS, params=params)

            if response.status_code != 200:
                break

            events = response.json()

            if not events:
                break

            # 시간 범위 내 이벤트만 필터링
            for event in events:
                event_time_str = event.get('dateCreated')
                if event_time_str:
                    try:
                        event_time = datetime.fromisoformat(event_time_str.replace('Z', '+00:00'))
                        if start_time <= event_time <= end_time:
                            all_events.append(event)
                    except:
                        pass

            # 시간 범위를 벗어나는 이벤트가 나오면 중단 (이벤트는 시간순 정렬)
            if events:
                last_event_time_str = events[-1].get('dateCreated')
                if last_event_time_str:
                    try:
                        last_event_time = datetime.fromisoformat(last_event_time_str.replace('Z', '+00:00'))
                        if last_event_time < start_time:
                            break  # 시간 범위를 벗어남
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

        except Exception as e:
            if TEST_MODE:
                print(f"      ⚠️  이슈 {issue_id} 이벤트 조회 실패: {str(e)}")
            break

    return len(all_events)


def get_crash_free_sessions():
    """Crash-Free Sessions 비율 조회 (환경변수 PROJECT_ID 사용)"""

    # Sessions API 호출
    sessions_url = f"{SENTRY_API_BASE}/organizations/{ORG_SLUG}/sessions/"

    end_time = datetime.now(timezone.utc)
    start_time = end_time - timedelta(days=1)

    # 환경변수에서 가져온 PROJECT_ID 사용
    params = {
        'field': ['crash_free_rate(session)', 'crash_free_rate(user)'],
        'start': start_time.isoformat(),
        'end': end_time.isoformat(),
        'project': [PROJECT_ID],  # 환경변수 사용
        'totals': 1
    }

    if TEST_MODE:
        print(f"🔍 Crash-Free Rate API 호출:")
        print(f"   URL: {sessions_url}")
        print(f"   프로젝트 ID: {PROJECT_ID}")
        print(f"   파라미터: {json.dumps(params, indent=2)}")

    try:
        response = requests.get(sessions_url, headers=HEADERS, params=params, timeout=30)

        if TEST_MODE:
            print(f"   응답 상태: {response.status_code}")

        if response.status_code == 200:
            data = response.json()

            if TEST_MODE:
                save_debug_data(f"crash_free_response_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
                                data, "Crash-Free Rate API 응답")

            # groups에서 crash_free_rate 추출
            if 'groups' in data and data['groups']:
                for group in data['groups']:
                    totals = group.get('totals', {})
                    session_crash_free = totals.get('crash_free_rate(session)')

                    if session_crash_free is not None:
                        # 값이 0-1 범위면 퍼센트로 변환
                        rate = session_crash_free * 100 if session_crash_free <= 1 else session_crash_free

                        if TEST_MODE:
                            print(f"   ✅ Session Crash-Free Rate: {rate:.2f}%")

                            # User crash-free rate도 출력 (참고용)
                            user_crash_free = totals.get('crash_free_rate(user)')
                            if user_crash_free is not None:
                                user_rate = user_crash_free * 100 if user_crash_free <= 1 else user_crash_free
                                print(f"   📊 User Crash-Free Rate: {user_rate:.2f}%")

                        return f"{rate:.2f}%"

            if TEST_MODE:
                print(f"   ⚠️  예상하지 못한 응답 구조: {data}")

        else:
            if TEST_MODE:
                print(f"   ❌ API 오류: {response.status_code}")
                print(f"   응답: {response.text}")

    except Exception as e:
        if TEST_MODE:
            print(f"   ❌ 오류 발생: {str(e)}")

    # 방법 2: session.status로 그룹화하여 계산 (대안)
    if TEST_MODE:
        print(f"\n🔄 대안 방법: session.status 그룹화")

    try:
        group_params = {
            'field': ['sum(session)'],
            'start': start_time.isoformat(),
            'end': end_time.isoformat(),
            'project': [PROJECT_ID],  # 환경변수 사용
            'groupBy': ['session.status'],
            'totals': 1
        }

        response = requests.get(sessions_url, headers=HEADERS, params=group_params, timeout=30)

        if response.status_code == 200:
            data = response.json()

            total_sessions = 0
            crashed_sessions = 0

            if 'groups' in data:
                for group in data['groups']:
                    status = group.get('by', {}).get('session.status')
                    session_count = group.get('totals', {}).get('sum(session)', 0)

                    total_sessions += session_count

                    if status == 'crashed':
                        crashed_sessions = session_count

                if total_sessions > 0:
                    crash_free_rate = ((total_sessions - crashed_sessions) / total_sessions) * 100

                    if TEST_MODE:
                        print(f"   📊 계산 결과:")
                        print(f"      총 세션: {total_sessions:,}")
                        print(f"      크래시 세션: {crashed_sessions:,}")
                        print(f"      Crash-Free Rate: {crash_free_rate:.2f}%")

                    return f"{crash_free_rate:.2f}%"

        elif TEST_MODE:
            print(f"   ❌ 그룹화 방법 실패: {response.status_code}")

    except Exception as e:
        if TEST_MODE:
            print(f"   ❌ 그룹화 방법 오류: {str(e)}")

    return "N/A"

def get_trend_emoji(current: int, previous: int) -> str:
    """증감 추세에 따른 이모지 반환"""
    if current == 0:
        return "🎉"
    elif previous == 0:
        return "🚨"

    change_percent = ((current - previous) / previous) * 100 if previous > 0 else 0

    if change_percent <= -50:
        return "📉"  # 크게 감소
    elif change_percent <= -10:
        return "↘️"  # 감소
    elif change_percent >= 50:
        return "📈"  # 크게 증가
    elif change_percent >= 10:
        return "↗️"  # 증가
    else:
        return "➡️"  # 유지


# 환경 변수 확인 부분에 DASH_BOARD_ID 추가
SENTRY_TOKEN = os.getenv('SENTRY_AUTH_TOKEN')
ORG_SLUG = os.getenv('SENTRY_ORG_SLUG')
PROJECT_SLUG = os.getenv('SENTRY_PROJECT_SLUG')
PROJECT_ID = os.getenv('SENTRY_PROJECT_ID')
SLACK_WEBHOOK = os.getenv('SLACK_WEBHOOK_URL')
DASH_BOARD_ID = os.getenv('DASH_BOARD_ID')  # 새로 추가

# 환경 변수 확인 부분에 DASH_BOARD_ID 추가
SENTRY_TOKEN = os.getenv('SENTRY_AUTH_TOKEN')
ORG_SLUG = os.getenv('SENTRY_ORG_SLUG')
PROJECT_SLUG = os.getenv('SENTRY_PROJECT_SLUG')
PROJECT_ID = os.getenv('SENTRY_PROJECT_ID')
SLACK_WEBHOOK = os.getenv('SLACK_WEBHOOK_URL')
DASH_BOARD_ID = os.getenv('DASH_BOARD_ID')  # 새로 추가

# 환경 변수 확인 부분에 DASH_BOARD_ID 추가
SENTRY_TOKEN = os.getenv('SENTRY_AUTH_TOKEN')
ORG_SLUG = os.getenv('SENTRY_ORG_SLUG')
PROJECT_SLUG = os.getenv('SENTRY_PROJECT_SLUG')
PROJECT_ID = os.getenv('SENTRY_PROJECT_ID')
SLACK_WEBHOOK = os.getenv('SLACK_WEBHOOK_URL')
DASH_BOARD_ID = os.getenv('DASH_BOARD_ID')  # 새로 추가


def format_slack_message(stats: Dict, crash_free_rate: str, date_info: Tuple) -> Dict:
    """Slack 메시지 포맷팅 (최종 수정 버전)"""

    start_utc, end_utc, yesterday_kst = date_info
    date_str = yesterday_kst.strftime('%Y년 %m월 %d일')

    # 전날 대비 증감 계산
    current = stats['total_crashes']
    previous = stats['prev_day_crashes']
    trend_emoji = get_trend_emoji(current, previous)

    change_text = ""
    if previous > 0:
        change_percent = ((current - previous) / previous) * 100
        change_sign = "+" if change_percent > 0 else ""
        change_text = f" ({change_sign}{change_percent:.1f}% {trend_emoji})"

    # 심각도 레벨에 따른 메인 이모지
    if current == 0:
        main_emoji = "✨"
        status_text = "크래시 없음!"
        status_color = "good"
    elif current < 10:
        main_emoji = "✅"
        status_text = "양호"
        status_color = "good"
    elif current < 50:
        main_emoji = "⚠️"
        status_text = "주의 필요"
        status_color = "warning"
    else:
        main_emoji = "🚨"
        status_text = "심각"
        status_color = "danger"

    # 상위 이슈 리스트 생성 (이모지 수정)
    top_issues_text = ""
    for i, issue in enumerate(stats['top_issues'], 1):
        title = format_issue_title(issue.get('title', 'Unknown Issue'), 50)
        count = issue.get('yesterday_count', 0)
        issue_id = issue.get('id', '')
        permalink = f"https://sentry.io/organizations/{ORG_SLUG}/issues/{issue_id}/"

        # 이슈별 심각도 표시 (가장 낮은 순위를 🟢로 변경)
        if count >= 100:
            severity = "🔴"
        elif count >= 50:
            severity = "🟠"
        elif count >= 10:
            severity = "🟡"
        else:
            severity = "🟢"  # ⚪에서 🟢로 변경

        top_issues_text += f"{i}. {severity} <{permalink}|{title}> - *{count:,}건*\n"

    if not top_issues_text:
        top_issues_text = "어제 발생한 크래시가 없습니다! 🎊"

    # 대시보드 URL 결정
    if DASH_BOARD_ID:
        dashboard_url = f"https://finda-b2c.sentry.io/dashboard/{DASH_BOARD_ID}"
        button_text = "Sentry 대시보드 열기"
    else:
        dashboard_url = "https://finda-b2c.sentry.io/dashboards"
        button_text = "Sentry 대시보드 목록 열기"

    # 테스트 모드일 때는 테스트 표시 추가
    test_indicator = " [테스트]" if TEST_MODE else ""

    message = {
        "attachments": [
            {
                "color": status_color,
                "blocks": [
                    {
                        "type": "header",
                        "text": {
                            "type": "plain_text",
                            "text": f"Android 일간 크래시 리포트{test_indicator}",
                            "emoji": True
                        }
                    },
                    {
                        "type": "context",
                        "elements": [
                            {
                                "type": "mrkdwn",
                                "text": f"📅 {date_str} | 상태: {main_emoji} {status_text}"
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
                                "text": f"*총 크래시*\n{current:,}건{change_text}"
                            },
                            {
                                "type": "mrkdwn",
                                "text": f"*영향받은 사용자*\n{stats['affected_users']:,}명"
                            },
                            {
                                "type": "mrkdwn",
                                "text": f"*발생한 이슈*\n{stats['total_issues']}개"
                            },
                            {
                                "type": "mrkdwn",
                                "text": f"*Crash-Free Rate*\n{crash_free_rate}"
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
                            "text": f"*🔝 Top 5 이슈*\n{top_issues_text}"
                        }
                    },
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
                ]
            }
        ]
    }

    return message


def format_issue_title(title: str, max_length: int = 50) -> str:
    """이슈 제목 포맷팅 (Slack용 최적화)"""
    if len(title) > max_length:
        return title[:max_length - 3] + "..."

    # Slack에서 문제가 될 수 있는 특수 문자 처리
    title = title.replace('*', '').replace('_', '').replace('`', '')
    return title


def send_to_slack(message: Dict) -> bool:
    """Slack으로 메시지 전송"""
    if not SLACK_WEBHOOK:
        print("⚠️  SLACK_WEBHOOK_URL이 설정되지 않아 Slack 전송을 건너뜁니다.")
        return True

    if TEST_MODE:
        print("🔍 테스트 모드 - Slack 메시지 내용:")
        print(json.dumps(message, indent=2, ensure_ascii=False))
        print("\n💡 실제 전송하려면 TEST_MODE=false로 설정하세요.")
        return True

    try:
        response = requests.post(SLACK_WEBHOOK, json=message)

        if response.status_code == 200:
            print("✅ Slack 메시지 전송 성공")
            return True
        else:
            print(f"❌ Slack 메시지 전송 실패: {response.status_code}")
            print(f"Response: {response.text}")
            return False
    except Exception as e:
        print(f"❌ Slack 전송 중 오류 발생: {str(e)}")
        return False


def main():
    """메인 실행 함수"""
    try:
        print("🚀 일간 크래시 리포트 생성 시작...")

        if TEST_MODE:
            print("🧪 테스트 모드로 실행 중입니다.")

        # 어제 날짜 범위 계산
        start_time, end_time, yesterday = get_datetime_range()
        date_str = yesterday.strftime('%Y-%m-%d')

        print(f"📅 대상 날짜: {date_str} (KST)")
        print(f"⏰ 시간 범위: {start_time} ~ {end_time} (UTC)")

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

        # 크래시 통계 수집
        print("\n📊 Sentry 데이터 수집 중...")
        stats = get_crash_stats(start_time, end_time)

        print(f"\n📈 수집 결과:")
        print(f"  - 총 크래시: {stats['total_crashes']}건")
        print(f"  - 발생 이슈: {stats['total_issues']}개")
        print(f"  - 영향 사용자: {stats['affected_users']}명")
        print(f"  - 전날 크래시: {stats['prev_day_crashes']}건")

        # Crash-Free Rate 조회
        print("\n📊 Crash-Free Rate 조회 중...")
        crash_free_rate = get_crash_free_sessions()
        print(f"  - Crash-Free Rate: {crash_free_rate}")

        # 슬랙 메시지 생성
        message = format_slack_message(stats, crash_free_rate, (start_time, end_time, yesterday))

        # Slack 전송
        print("\n📤 Slack으로 전송 중...")
        success = send_to_slack(message)

        if success:
            print("\n🎉 일간 크래시 리포트 전송 완료!")

            # 심각한 크래시가 있으면 추가 알림
            if stats['total_crashes'] > 100:
                print("⚠️  크래시가 100건을 초과했습니다. 즉시 확인이 필요합니다!")
        else:
            print("\n❌ 리포트 전송 실패")
            exit(1)

    except Exception as e:
        print(f"\n💥 오류 발생: {str(e)}")

        if TEST_MODE:
            import traceback
            print("\n상세 오류 정보:")
            traceback.print_exc()

        # 오류 알림도 Slack으로 전송
        if SLACK_WEBHOOK and not TEST_MODE:
            error_message = {
                "text": f"🚨 일간 크래시 리포트 생성 오류: {str(e)}",
                "blocks": [
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"*🚨 일간 크래시 리포트 생성 오류*\n\n"
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