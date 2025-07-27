#!/usr/bin/env python3
"""
Sentry 이슈 상세 분석
왜 0건이 나오는지 정확히 확인
"""

import os
import requests
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

# dotenv 지원
try:
    from dotenv import load_dotenv

    if Path('.env').exists():
        load_dotenv()
except ImportError:
    pass

# 환경 변수
SENTRY_TOKEN = os.getenv('SENTRY_AUTH_TOKEN')
ORG_SLUG = os.getenv('SENTRY_ORG_SLUG')
PROJECT_SLUG = os.getenv('SENTRY_PROJECT_SLUG')

SENTRY_API_BASE = "https://sentry.io/api/0"
HEADERS = {
    'Authorization': f'Bearer {SENTRY_TOKEN}',
    'Content-Type': 'application/json'
}

KST = timezone(timedelta(hours=9))


def analyze_issues():
    """이슈와 이벤트 상세 분석"""
    print("🔍 Sentry 이슈 상세 분석")
    print("=" * 50)

    # 1. 먼저 모든 이슈 조회 (필터 없이)
    print("\n1️⃣ 모든 이슈 조회 (필터 없음)")
    issues_url = f"{SENTRY_API_BASE}/projects/{ORG_SLUG}/{PROJECT_SLUG}/issues/"

    params = {
        'query': 'is:unresolved',
        'limit': 5,
        'sort': 'date'
    }

    response = requests.get(issues_url, headers=HEADERS, params=params)

    if response.status_code != 200:
        print(f"❌ 오류: {response.status_code}")
        return

    issues = response.json()
    print(f"✅ 총 {len(issues)}개 이슈 (상위 5개)")

    # 각 이슈 상세 분석
    for i, issue in enumerate(issues, 1):
        print(f"\n━━━ 이슈 #{i} ━━━")
        print(f"제목: {issue.get('title', '')[:60]}")
        print(f"ID: {issue.get('id')}")
        print(f"레벨: {issue.get('level', 'unknown')}")
        print(f"타입: {issue.get('type', 'unknown')}")
        print(f"플랫폼: {issue.get('platform', 'unknown')}")
        print(f"총 이벤트: {issue.get('count', 0)}")
        print(f"사용자 수: {issue.get('userCount', 0)}")
        print(f"최초 발생: {issue.get('firstSeen')}")
        print(f"최근 발생: {issue.get('lastSeen')}")

        # Stats 정보 확인
        if 'stats' in issue:
            print(f"Stats: {issue['stats']}")

        # 2. 특정 날짜의 이벤트 확인
        target_date = datetime(2025, 1, 26, tzinfo=KST)
        start_time = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_time = target_date.replace(hour=23, minute=59, second=59, microsecond=999999)

        start_utc = start_time.astimezone(timezone.utc)
        end_utc = end_time.astimezone(timezone.utc)

        print(f"\n📅 2025-01-26 이벤트 확인:")

        # 이슈별 이벤트 조회
        if issue.get('id'):
            events_url = f"{SENTRY_API_BASE}/issues/{issue['id']}/events/"

            # 방법 1: 시간 범위로 조회
            events_params = {
                'start': start_utc.isoformat(),
                'end': end_utc.isoformat(),
                'limit': 5
            }

            print(f"   요청 파라미터: {json.dumps(events_params, indent=2)}")

            events_response = requests.get(events_url, headers=HEADERS, params=events_params)

            if events_response.status_code == 200:
                events = events_response.json()
                print(f"   ✅ 해당 날짜 이벤트: {len(events)}개")

                if events:
                    for j, event in enumerate(events[:3], 1):
                        print(f"      이벤트 {j}:")
                        print(f"         - 시간: {event.get('dateCreated')}")
                        print(f"         - ID: {event.get('id')}")
                        print(f"         - 타입: {event.get('type')}")
                else:
                    # 이벤트가 없으면 전체 이벤트 확인
                    print("   ⚠️  해당 날짜에 이벤트가 없음")
                    print("   🔍 최근 이벤트 확인:")

                    recent_params = {'limit': 3}
                    recent_response = requests.get(events_url, headers=HEADERS, params=recent_params)

                    if recent_response.status_code == 200:
                        recent_events = recent_response.json()
                        for event in recent_events:
                            print(f"      - {event.get('dateCreated')}")
            else:
                print(f"   ❌ 이벤트 조회 실패: {events_response.status_code}")

    # 3. 프로젝트 전체 이벤트 스트림 확인
    print("\n\n2️⃣ 프로젝트 전체 이벤트 확인")
    events_url = f"{SENTRY_API_BASE}/projects/{ORG_SLUG}/{PROJECT_SLUG}/events/"

    # 날짜 범위로 조회
    params = {
        'start': start_utc.isoformat(),
        'end': end_utc.isoformat(),
        'limit': 10
    }

    print(f"요청 URL: {events_url}")
    print(f"요청 파라미터: {json.dumps(params, indent=2)}")

    response = requests.get(events_url, headers=HEADERS, params=params)

    if response.status_code == 200:
        events = response.json()
        print(f"\n✅ 2025-01-26 전체 이벤트: {len(events)}개")

        if events:
            # 이벤트 타입별 집계
            event_types = {}
            levels = {}

            for event in events:
                # 타입별
                event_type = event.get('type', 'unknown')
                event_types[event_type] = event_types.get(event_type, 0) + 1

                # 레벨별
                level = event.get('level', 'unknown')
                levels[level] = levels.get(level, 0) + 1

            print(f"\n📊 이벤트 타입별 분포: {event_types}")
            print(f"📊 레벨별 분포: {levels}")

            print(f"\n📋 샘플 이벤트:")
            for i, event in enumerate(events[:3], 1):
                print(f"{i}. {event.get('title', 'No title')[:50]}")
                print(f"   - 시간: {event.get('dateCreated')}")
                print(f"   - 타입: {event.get('type')}")
                print(f"   - 레벨: {event.get('level')}")
                print(f"   - 이슈 ID: {event.get('groupID')}")
    else:
        print(f"❌ 이벤트 조회 실패: {response.status_code}")
        print(f"응답: {response.text}")

    # 4. API 엔드포인트 차이 확인
    print("\n\n3️⃣ 다양한 API 엔드포인트 테스트")

    # Organization events API
    org_events_url = f"{SENTRY_API_BASE}/organizations/{ORG_SLUG}/events/"
    params = {
        'project': PROJECT_SLUG,
        'start': start_utc.isoformat(),
        'end': end_utc.isoformat(),
        'limit': 5
    }

    print(f"\n조직 이벤트 API: {org_events_url}")
    response = requests.get(org_events_url, headers=HEADERS, params=params)

    if response.status_code == 200:
        data = response.json()
        print(f"✅ 결과: {len(data.get('data', []))}개 이벤트")
    else:
        print(f"❌ 오류: {response.status_code}")


if __name__ == "__main__":
    analyze_issues()