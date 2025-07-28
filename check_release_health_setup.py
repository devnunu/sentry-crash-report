#!/usr/bin/env python3
"""
Release Health 설정 상태 확인
"""

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

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


def check_project_settings():
    """프로젝트 설정 확인"""
    print("🔍 프로젝트 설정 확인")
    print("=" * 50)

    project_url = f"{SENTRY_API_BASE}/projects/{ORG_SLUG}/{PROJECT_SLUG}/"

    try:
        response = requests.get(project_url, headers=HEADERS, timeout=30)

        if response.status_code == 200:
            project = response.json()

            print(f"✅ 프로젝트 정보:")
            print(f"   - 이름: {project.get('name')}")
            print(f"   - 플랫폼: {project.get('platform')}")
            print(f"   - ID: {project.get('id')}")
            print(f"   - 상태: {project.get('status')}")

            # Release Health 관련 설정 확인
            features = project.get('features', [])
            print(f"   - 활성화된 기능들: {features}")

            # 옵션 확인
            options = project.get('options', {})
            session_related = {k: v for k, v in options.items() if 'session' in k.lower()}
            if session_related:
                print(f"   - Session 관련 설정: {session_related}")

            return project.get('id')
        else:
            print(f"❌ 프로젝트 조회 실패: {response.status_code}")
            return None
    except Exception as e:
        print(f"❌ 오류: {str(e)}")
        return None


def check_recent_releases():
    """최근 릴리스 상태 확인"""
    print(f"\n🔍 최근 릴리스 상태 확인")
    print("=" * 50)

    releases_url = f"{SENTRY_API_BASE}/projects/{ORG_SLUG}/{PROJECT_SLUG}/releases/"

    try:
        response = requests.get(releases_url, headers=HEADERS, params={'limit': 10}, timeout=30)

        if response.status_code == 200:
            releases = response.json()

            print(f"✅ 총 {len(releases)}개 릴리스 발견")

            for i, release in enumerate(releases[:5], 1):
                version = release.get('version', 'Unknown')
                date_created = release.get('dateCreated', 'Unknown')

                print(f"\n{i}. 릴리스: {version}")
                print(f"   - 생성일: {date_created}")
                print(f"   - 상태: {release.get('status', 'Unknown')}")

                # 건강 데이터 확인
                health_data = release.get('healthData')
                if health_data:
                    print(f"   - ✅ 건강 데이터 있음:")
                    print(f"     * 총 세션: {health_data.get('totalSessions', 'N/A')}")
                    print(f"     * Crash-Free Sessions: {health_data.get('sessionsCrashFreeRate', 'N/A')}")
                    print(f"     * Crash-Free Users: {health_data.get('usersCrashFreeRate', 'N/A')}")
                    print(f"     * 총 사용자: {health_data.get('totalUsers', 'N/A')}")
                else:
                    print(f"   - ❌ 건강 데이터 없음")

                # 추가 메타데이터 확인
                print(f"   - 새 그룹: {release.get('newGroups', 0)}")
                print(f"   - 작성자: {release.get('authors', [])}")
        else:
            print(f"❌ 릴리스 조회 실패: {response.status_code}")
    except Exception as e:
        print(f"❌ 오류: {str(e)}")


def test_sessions_api_variants():
    """다양한 Sessions API 호출 시도"""
    print(f"\n🔍 Sessions API 다양한 호출 시도")
    print("=" * 50)

    project_id = 1539536
    end_time = datetime.now(timezone.utc)
    start_time = end_time - timedelta(days=7)  # 7일로 범위 확대

    test_cases = [
        {
            "name": "기본 crash_free_rate",
            "params": {
                'field': ['crash_free_rate(session)'],
                'start': start_time.isoformat(),
                'end': end_time.isoformat(),
                'project': [project_id],
                'totals': 1
            }
        },
        {
            "name": "세션 합계와 크래시 카운트",
            "params": {
                'field': ['sum(session)', 'count_crashed(session)'],
                'start': start_time.isoformat(),
                'end': end_time.isoformat(),
                'project': [project_id],
                'totals': 1
            }
        },
        {
            "name": "session.status로 그룹화",
            "params": {
                'field': ['sum(session)'],
                'start': start_time.isoformat(),
                'end': end_time.isoformat(),
                'project': [project_id],
                'groupBy': ['session.status'],
                'totals': 1
            }
        },
        {
            "name": "단순 카운트",
            "params": {
                'field': ['count_unique(user)', 'sum(session)'],
                'start': start_time.isoformat(),
                'end': end_time.isoformat(),
                'project': [project_id],
                'totals': 1
            }
        }
    ]

    sessions_url = f"{SENTRY_API_BASE}/organizations/{ORG_SLUG}/sessions/"

    for test_case in test_cases:
        print(f"\n🧪 테스트: {test_case['name']}")
        print(f"   파라미터: {json.dumps(test_case['params'], indent=2)}")

        try:
            response = requests.get(sessions_url, headers=HEADERS, params=test_case['params'], timeout=30)
            print(f"   상태: {response.status_code}")

            if response.status_code == 200:
                data = response.json()
                print(f"   ✅ 성공!")

                # 데이터 구조 출력
                if 'totals' in data:
                    print(f"   📊 Totals: {data['totals']}")
                if 'groups' in data and data['groups']:
                    print(f"   📊 Groups: {len(data['groups'])}개")
                    for group in data['groups'][:3]:
                        print(f"      - {group.get('by', {})}: {group.get('totals', {})}")

                # 실제 데이터가 있는지 확인
                if data.get('totals') and any(v > 0 for v in data['totals'].values() if isinstance(v, (int, float))):
                    print(f"   🎯 실제 데이터 발견!")
                    return data
                else:
                    print(f"   ⚠️  데이터는 있지만 값이 0")
            else:
                print(f"   ❌ 실패: {response.text}")
        except Exception as e:
            print(f"   ❌ 오류: {str(e)}")

    return None


def check_sdk_integration():
    """SDK 통합 상태 확인 (이벤트 기반)"""
    print(f"\n🔍 SDK 통합 상태 확인")
    print("=" * 50)

    # 최근 이벤트에서 SDK 정보 확인
    events_url = f"{SENTRY_API_BASE}/projects/{ORG_SLUG}/{PROJECT_SLUG}/events/"

    try:
        response = requests.get(events_url, headers=HEADERS, params={'limit': 5}, timeout=30)

        if response.status_code == 200:
            events = response.json()

            if events:
                print(f"✅ 최근 {len(events)}개 이벤트 발견")

                for i, event in enumerate(events[:3], 1):
                    print(f"\n{i}. 이벤트 ID: {event.get('id')}")
                    print(f"   - 시간: {event.get('dateCreated')}")
                    print(f"   - 플랫폼: {event.get('platform')}")

                    # SDK 정보 확인
                    sdk = event.get('sdk')
                    if sdk:
                        print(f"   - SDK: {sdk.get('name')} v{sdk.get('version')}")

                        # Release Health 지원 SDK인지 확인
                        sdk_name = sdk.get('name', '').lower()
                        if 'android' in sdk_name or 'ios' in sdk_name or 'react-native' in sdk_name:
                            print(f"   - ✅ Release Health 지원 SDK")
                        else:
                            print(f"   - ⚠️  Release Health 미지원 SDK일 수 있음")

                    # 릴리스 정보 확인
                    release = event.get('release')
                    if release:
                        print(f"   - 릴리스: {release.get('version', 'Unknown')}")
                    else:
                        print(f"   - ❌ 릴리스 정보 없음")
            else:
                print(f"❌ 최근 이벤트가 없습니다.")
        else:
            print(f"❌ 이벤트 조회 실패: {response.status_code}")
    except Exception as e:
        print(f"❌ 오류: {str(e)}")


def main():
    """메인 함수"""
    print("🚀 Release Health 설정 상태 진단")
    print("=" * 60)

    # 1. 프로젝트 설정 확인
    project_id = check_project_settings()

    # 2. 릴리스 상태 확인
    check_recent_releases()

    # 3. Sessions API 테스트
    session_data = test_sessions_api_variants()

    # 4. SDK 통합 상태 확인
    check_sdk_integration()

    # 5. 결론 및 권장사항
    print(f"\n" + "=" * 60)
    print("📋 진단 결과 및 권장사항")
    print("=" * 60)

    if session_data:
        print("✅ Session 데이터가 발견되었습니다!")
        print("   → Crash-Free Rate 조회가 가능할 것입니다.")
    else:
        print("❌ Session 데이터가 없습니다.")
        print("\n💡 해결 방법:")
        print("1. Android SDK에서 Release Health 활성화:")
        print("   - SDK 버전 4.0+ 사용")
        print("   - Release 설정: SentryAndroid.init { options -> options.release = \"버전\" }")
        print("   - Session 추적 활성화 확인")
        print("\n2. 새로운 릴리스 배포:")
        print("   - Release Health가 활성화된 상태로 새 버전 배포")
        print("   - 사용자들이 새 버전을 사용할 때까지 대기")
        print("\n3. 현재 상태에서는:")
        print("   - Crash-Free Rate: N/A로 표시")
        print("   - 다른 크래시 통계는 정상 작동")


if __name__ == "__main__":
    main()