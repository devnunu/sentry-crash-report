"""
모니터링 상태 관리 모듈
monitoring_state.json 파일을 통한 릴리즈 상태 추적
단일 버전으로 통합 관리
"""

import json
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, List

from config import MONITORING_STATE_FILE, MONITORING_PERIODS, TEST_MODE


def get_active_monitoring_releases() -> List[Dict]:
    """활성 모니터링 릴리즈 목록 반환"""
    try:
        if not Path(MONITORING_STATE_FILE).exists():
            return []

        with open(MONITORING_STATE_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)

        releases = data.get('releases', [])

        # 유효한 릴리즈만 반환
        valid_releases = []
        for release in releases:
            if release.get('version') and release.get('start_time'):
                valid_releases.append(release)

        return valid_releases

    except (FileNotFoundError, json.JSONDecodeError) as e:
        if TEST_MODE:
            print(f"⚠️ 상태 파일 읽기 오류: {e}")
        return []

def add_monitoring_release(release_data: Dict) -> bool:
    """새 릴리즈를 모니터링 목록에 추가 또는 기존 릴리즈 업데이트"""
    try:
        # 기존 릴리즈 목록 로드
        releases = get_active_monitoring_releases()

        version = release_data.get('version')
        if not version:
            print(f"❌ 릴리즈 버전이 없습니다.")
            return False

        # 동일 버전이 이미 있는지 확인
        existing_release = None
        for i, existing in enumerate(releases):
            if existing.get('version') == version:
                existing_release = existing
                existing_index = i
                break

        if existing_release:
            # 기존 릴리즈 업데이트 (더 최신 정보로)
            print(f"📝 릴리즈 {version}이 이미 존재합니다. 정보를 업데이트합니다.")

            # 기존 정보 유지하면서 새 정보 병합
            updated_release = existing_release.copy()
            updated_release.update(release_data)

            # updated_at 필드 추가
            updated_release['updated_at'] = datetime.now(timezone.utc).isoformat()

            releases[existing_index] = updated_release

            print(f"✅ 릴리즈 {version} 정보가 업데이트되었습니다.")
        else:
            # 새 릴리즈 추가
            releases.append(release_data)
            print(f"📝 릴리즈 {version} 모니터링 목록에 추가되었습니다.")

        # 파일 저장
        save_monitoring_releases(releases)
        return True

    except Exception as e:
        print(f"❌ 릴리즈 추가/업데이트 실패: {e}")
        return False

def save_monitoring_releases(releases: List[Dict]) -> bool:
    """릴리즈 목록을 파일에 저장"""
    try:
        data = {
            'releases': releases,
            'last_updated': datetime.now(timezone.utc).isoformat(),
            'total_count': len(releases)
        }

        with open(MONITORING_STATE_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

        return True

    except Exception as e:
        print(f"❌ 상태 파일 저장 실패: {e}")
        return False

def remove_release(version: str) -> bool:
    """특정 버전의 릴리즈를 목록에서 제거"""
    try:
        releases = get_active_monitoring_releases()

        # 해당 버전 제거
        updated_releases = [r for r in releases if r.get('version') != version]

        if len(updated_releases) == len(releases):
            print(f"⚠️ 릴리즈 {version}을 찾을 수 없습니다.")
            return False

        save_monitoring_releases(updated_releases)
        print(f"🗑️ 릴리즈 {version}이 모니터링 목록에서 제거되었습니다.")
        return True

    except Exception as e:
        print(f"❌ 릴리즈 제거 실패: {e}")
        return False

def get_monitoring_phase(release: Dict) -> str:
    """릴리즈의 현재 모니터링 단계 반환 (start_time 기준)"""
    try:
        now = datetime.now(timezone.utc)
        start_time_str = release.get('start_time')

        if not start_time_str:
            return 'invalid'

        # 시작 시간 파싱
        start_time = datetime.fromisoformat(start_time_str.replace('Z', '+00:00'))
        elapsed = now - start_time

        # 단계 판단
        if elapsed < timedelta(seconds=0):
            return 'scheduled'  # 아직 시작 전
        elif elapsed < timedelta(hours=MONITORING_PERIODS['intensive_hours']):
            return 'intensive'  # 집중 모니터링 (0-6시간)
        elif elapsed < timedelta(days=MONITORING_PERIODS['total_days']):
            return 'normal'     # 일반 모니터링 (6시간-7일)
        else:
            return 'completed'  # 완료 (7일 후)

    except Exception as e:
        if TEST_MODE:
            print(f"⚠️ 단계 판단 오류: {e}")
        return 'invalid'

def should_monitor_now(release: Dict, phase: str) -> bool:
    """현재 모니터링해야 하는지 판단"""
    if phase == 'intensive':
        return True  # 집중 모니터링: 매번 실행 (15분마다)
    elif phase == 'normal':
        # 일반 모니터링: 1시간마다 (정시에만)
        return datetime.now().minute == 0
    else:
        return False  # scheduled, completed, invalid

def cleanup_completed_releases() -> int:
    """완료된 릴리즈들을 정리하고 제거된 개수 반환"""
    try:
        releases = get_active_monitoring_releases()
        active_releases = []
        completed_count = 0

        for release in releases:
            phase = get_monitoring_phase(release)

            if phase == 'completed':
                version = release.get('version', 'unknown')
                print(f"🎉 릴리즈 {version} 모니터링 완료 (7일 경과)")
                completed_count += 1
            elif phase != 'invalid':
                active_releases.append(release)
            else:
                # 잘못된 데이터도 제거
                version = release.get('version', 'unknown')
                print(f"🗑️ 잘못된 릴리즈 데이터 제거: {version}")
                completed_count += 1

        if completed_count > 0:
            save_monitoring_releases(active_releases)
            print(f"✅ {completed_count}개 릴리즈가 정리되었습니다.")

        return completed_count

    except Exception as e:
        print(f"❌ 릴리즈 정리 실패: {e}")
        return 0

def get_release_summary() -> Dict:
    """현재 모니터링 상태 요약 정보 반환"""
    releases = get_active_monitoring_releases()

    summary = {
        'total_releases': len(releases),
        'by_phase': {
            'scheduled': 0,
            'intensive': 0,
            'normal': 0,
            'completed': 0,
            'invalid': 0
        },
        'releases': []
    }

    for release in releases:
        phase = get_monitoring_phase(release)
        summary['by_phase'][phase] += 1

        # 경과 시간 계산
        start_time_str = release.get('start_time')
        elapsed_text = "Unknown"
        if start_time_str:
            try:
                start_time = datetime.fromisoformat(start_time_str.replace('Z', '+00:00'))
                elapsed = datetime.now(timezone.utc) - start_time
                elapsed_hours = elapsed.total_seconds() / 3600

                if elapsed_hours >= 24:
                    elapsed_text = f"{elapsed_hours/24:.0f}일"
                elif elapsed_hours >= 1:
                    elapsed_text = f"{elapsed_hours:.0f}시간"
                else:
                    elapsed_text = f"{elapsed_hours*60:.0f}분"
            except:
                pass

        summary['releases'].append({
            'version': release.get('version'),
            'phase': phase,
            'start_time': release.get('start_time'),
            'environment': release.get('environment', 'unknown'),
            'elapsed': elapsed_text,
            'created_by': release.get('created_by', 'unknown')
        })

    return summary

def create_test_release(version: str = None, hours_ago: int = 0) -> Dict:
    """테스트용 릴리즈 데이터 생성"""
    # .env에서 기본값 로드
    if not version:
        version = os.getenv('TEST_RELEASE_VERSION') or f"test-{datetime.now().strftime('%H%M%S')}"

    start_time = datetime.now(timezone.utc) - timedelta(hours=hours_ago)

    # .env에서 설정 로드
    duration_hours = int(os.getenv('TEST_MONITORING_DURATION', '168'))
    environment = os.getenv('SENTRY_ENVIRONMENT', 'Test')

    release_data = {
        'version': version,
        'start_time': start_time.isoformat(),
        'duration_hours': duration_hours,
        'environment': environment,
        'created_at': datetime.now(timezone.utc).isoformat(),
        'created_by': 'local_test'
    }

    return release_data

def print_monitoring_status():
    """현재 모니터링 상태를 보기 좋게 출력"""
    summary = get_release_summary()

    print(f"\n📊 모니터링 상태 요약:")
    print(f"   - 총 릴리즈: {summary['total_releases']}개")

    if summary['total_releases'] == 0:
        print("   - 현재 모니터링 중인 릴리즈가 없습니다.")
        return

    for phase, count in summary['by_phase'].items():
        if count > 0:
            phase_name = {
                'scheduled': '예정',
                'intensive': '집중 모니터링',
                'normal': '일반 모니터링',
                'completed': '완료',
                'invalid': '오류'
            }.get(phase, phase)
            print(f"   - {phase_name}: {count}개")

    print(f"\n📋 릴리즈 상세:")
    for release_info in summary['releases']:
        version = release_info['version']
        phase = release_info['phase']
        env = release_info['environment']
        elapsed = release_info['elapsed']
        created_by = release_info['created_by']

        phase_emoji = {
            'scheduled': '⏳',
            'intensive': '🔥',
            'normal': '👀',
            'completed': '✅',
            'invalid': '❌'
        }.get(phase, '❓')

        phase_name = {
            'scheduled': '예정',
            'intensive': '집중',
            'normal': '일반',
            'completed': '완료',
            'invalid': '오류'
        }.get(phase, phase)

        print(f"   {phase_emoji} {version} ({env}) - {phase_name} | 경과: {elapsed} | 생성자: {created_by}")

def get_release_by_version(version: str) -> Dict:
    """특정 버전의 릴리즈 정보 반환"""
    releases = get_active_monitoring_releases()

    for release in releases:
        if release.get('version') == version:
            return release

    return None

def update_release_info(version: str, update_data: Dict) -> bool:
    """특정 릴리즈의 정보 업데이트"""
    try:
        releases = get_active_monitoring_releases()

        for i, release in enumerate(releases):
            if release.get('version') == version:
                # 기존 정보에 새 정보 병합
                releases[i].update(update_data)
                releases[i]['updated_at'] = datetime.now(timezone.utc).isoformat()

                save_monitoring_releases(releases)
                print(f"✅ 릴리즈 {version} 정보가 업데이트되었습니다.")
                return True

        print(f"⚠️ 릴리즈 {version}을 찾을 수 없습니다.")
        return False

    except Exception as e:
        print(f"❌ 릴리즈 업데이트 실패: {e}")
        return False