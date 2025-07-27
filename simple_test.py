#!/usr/bin/env python3
"""
Sentry API 간단 테스트
정확한 날짜로 데이터 조회
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


def test_specific_date():
    """특정 날짜(2025-01-26)의 데이터 조회"""
    print("🚀 Sentry 데이터 테스트 (2025-01-26)")
    print("=" * 50)

    # 2025년 1월 26일 (어제) 설정
    KST = timezone(timedelta(hours=9))
    target_date = datetime(2025, 1, 26, tzinfo=KST)

    start_time = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
    end_time = target_date.replace(hour=23, minute=59, second=59, microsecond=999999)

    # UTC로 변환
    start_utc = start_time.astimezone(timezone.utc)
    end_utc = end_time.astimezone(timezone.utc)

    print(f"📅 대상 날짜: {target_date.strftime('%Y-%m-%d')} (KST)")
    print(f"⏰ UTC 범위: {start_utc} ~ {end_utc}")

    # 1. 이슈 조회 (시간 범위 지정)
    print("\n1️⃣ 이슈 조회")
    issues_url = f"{SENTRY_API_BASE}/projects/{ORG_SLUG}/{PROJECT_SLUG}/issues/"

    # 다양한 방법으로 시도
    queries = [
        {
            "name": "기본 쿼리",
            "params": {
                'query': 'is:unresolved',
                'start': start_utc.isoformat(),
                'end': end_utc.isoformat(),
                'limit': 10
            }
        },
        {
            "name": "statsPeriod 사용",
            "params": {
                'query': 'is:unresolved',
                'statsPeriod': '24h',
                'limit': 10
            }
        }
    ]

    for q in queries:
        print(f"\n🔍 {q['name']}")
        print(f"   파라미터: {json.dumps(q['params'], indent=2)}")

        response = requests.get(issues_url, headers=HEADERS, params=q['params'])

        if response.status_code == 200:
            issues = response.json()
            print(f"   ✅ 결과: {len(issues)}개 이슈")

            if issues:
                issue = issues[0]
                print(f"   📋 첫 번째 이슈:")
                print(f"      - 제목: {issue.get('title', 'No title')[:50]}")
                print(f"      - ID: {issue.get('id')}")
                print(f"      - 레벨: {issue.get('level')}")
                print(f"      - 카운트: {issue.get('count')}")
                print(f"      - 사용자: {issue.get('userCount')}")
                print(f"      - 최초 발생: {issue.get('firstSeen')}")
                print(f"      - 최근 발생: {issue.get('lastSeen')}")

                # 해당 이슈의 이벤트 개수 확인
                if issue.get('id'):
                    print(f"\n   🔍 이슈 {issue['id']}의 어제 이벤트 확인...")
                    events_url = f"{SENTRY_API_BASE}/issues/{issue['id']}/events/"
                    events_params = {
                        'start': start_utc.isoformat(),
                        'end': end_utc.isoformat(),
                        'limit': 100
                    }

                    events_response = requests.get(events_url, headers=HEADERS, params=events_params)
                    if events_response.status_code == 200:
                        events = events_response.json()
                        print(f"      ✅ 어제 이벤트: {len(events)}개")

                        if events:
                            print(f"      📋 첫 번째 이벤트:")
                            event = events[0]
                            print(f"         - 시간: {event.get('dateCreated')}")
                            print(f"         - 레벨: {event.get('level')}")
                            print(f"         - 플랫폼: {event.get('platform')}")
        else:
            print(f"   ❌ 오류: {response.status_code}")
            print(f"   응답: {response.text}")

    # 2. 직접 이벤트 조회
    print("\n2️⃣ 직접 이벤트 조회")
    events_url = f"{SENTRY_API_BASE}/projects/{ORG_SLUG}/{PROJECT_SLUG}/events/"

    params = {
        'start': start_utc.isoformat(),
        'end': end_utc.isoformat(),
        'limit': 10
    }

    response = requests.get(events_url, headers=HEADERS, params=params)

    if response.status_code == 200:
        events = response.json()
        print(f"✅ 이벤트: {len(events)}개")

        # 레벨별 집계
        levels = {}
        for event in events:
            level = event.get('level', 'unknown')
            levels[level] = levels.get(level, 0) + 1

        print(f"📊 레벨별 분포: {levels}")

        if events:
            print("\n📋 샘플 이벤트:")
            for i, event in enumerate(events[:3], 1):
                print(f"   {i}. 시간: {event.get('dateCreated')}")
                print(f"      제목: {event.get('title', 'No title')[:50]}")
                print(f"      레벨: {event.get('level')}")
                print(f"      타입: {event.get('type')}")
    else:
        print(f"❌ 오류: {response.status_code}")


if __name__ == "__main__":
    test_specific_date()