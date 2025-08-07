"""
알림 발송 관리 모듈 - 레벨링 시스템 적용
Slack 메시지 포맷팅 및 전송
"""

import json
from datetime import datetime, timezone
from typing import Dict

import requests

from config import (
    SLACK_WEBHOOK, DASH_BOARD_ID, ORG_SLUG, ENVIRONMENT, TEST_MODE,
    is_local_environment, utc_to_kst
)


def send_to_slack(message: Dict) -> bool:
    """Slack으로 메시지 전송"""
    print("🔍 TEST_MODE 디버깅:")
    print(f"   - config.TEST_MODE: {TEST_MODE}")
    print(f"   - type(TEST_MODE): {type(TEST_MODE)}")

    if not SLACK_WEBHOOK:
        print("⚠️ SLACK_WEBHOOK_URL이 설정되지 않아 Slack 전송을 건너뜁니다.")
        return True

    # if TEST_MODE or is_local_environment():
    if TEST_MODE:
        print("\n🔍 테스트 모드 - Slack 메시지 내용:")
        print("=" * 60)
        print(json.dumps(message, indent=2, ensure_ascii=False))
        print("=" * 60)
        print("💡 실제 전송하려면 TEST_MODE=false로 설정하세요.\n")
        return True

    try:
        response = requests.post(SLACK_WEBHOOK, json=message, timeout=30)

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


def format_level_alert(analysis_result: Dict) -> Dict:
    """레벨링 기반 알림 메시지 포맷팅"""

    release_version = analysis_result['release_version']
    risk = analysis_result['risk_assessment']
    current = analysis_result['current_analysis']
    levels = risk['details']
    critical_issues = analysis_result['critical_issues']
    recommendations = analysis_result['recommendations']
    period = analysis_result['analysis_period']

    # 전체 위험도 레벨
    overall_level = risk['level']
    overall_status = risk['status']

    # 색상 결정 (레벨에 따른)
    if overall_level >= 4:
        color = "danger"
        main_emoji = "🚨"
    elif overall_level >= 3:
        color = "warning"
        main_emoji = "⚠️"
    elif overall_level >= 1:
        color = "warning"
        main_emoji = "🔶"
    else:
        color = "good"
        main_emoji = "✅"

    # 분석 기간 정보
    period_desc = period['description']

    # 레벨별 상세 정보
    level_details = []

    crash_level = levels['crash']
    if crash_level['level'] > 0:
        level_details.append(
            f"📊 크래시: Level {crash_level['level']} - {current['total_crashes']}건 ({crash_level['status']})")

    fatal_level = levels['fatal']
    if fatal_level['level'] > 0:
        level_details.append(
            f"💀 Fatal: Level {fatal_level['level']} - {current['total_fatal']}건 ({fatal_level['status']})")

    user_level = levels['user_impact']
    if user_level['level'] > 0:
        level_details.append(
            f"👥 사용자: Level {user_level['level']} - {current['affected_users']}명 ({user_level['status']})")

    single_level = levels['single_issue']
    if single_level['level'] > 0:
        max_issue_count = max([issue['count'] for issue in critical_issues], default=0)
        level_details.append(f"🎯 단일이슈: Level {single_level['level']} - {max_issue_count}건 ({single_level['status']})")

    level_details_text = "\n".join(level_details) if level_details else "모든 지표가 정상 범위입니다."

    # 상위 이슈 텍스트
    issues_text = ""
    for i, issue in enumerate(critical_issues[:3], 1):
        severity_emoji = "🔴" if issue['level'] == 'fatal' else "🟠"
        issues_text += f"{i}. {severity_emoji} <{issue['sentry_url']}|{issue['title']}>\n"
        issues_text += f"   - 발생: {issue['count']}건, 영향: {issue['users']}명\n"

    if not issues_text:
        issues_text = "주요 이슈가 감지되지 않았습니다."

    # 권장 조치 텍스트
    recommendations_text = "\n".join([f"• {rec}" for rec in recommendations[:4]])

    test_indicator = " [테스트]" if TEST_MODE else ""

    # 한국 시간으로 변환
    kst_time = utc_to_kst(datetime.now(timezone.utc))

    message = {
        "attachments": [
            {
                "color": color,
                "blocks": [
                    {
                        "type": "header",
                        "text": {
                            "type": "plain_text",
                            "text": f"{main_emoji} {release_version} 모니터링 알림{test_indicator}",
                            "emoji": True
                        }
                    },
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"📱 *버전:* {release_version}\n"
                                    f"📊 *분석기간:* {period_desc}\n"
                                    f"⚠️ *위험도:* Level {overall_level} ({overall_status})\n"
                                    f"🌍 *환경:* {ENVIRONMENT}"
                        }
                    },
                    {
                        "type": "divider"
                    },
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"*📈 레벨별 상세 현황:*\n{level_details_text}"
                        }
                    },
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"*🔥 주요 이슈:*\n{issues_text}"
                        }
                    },
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"*💡 권장 조치:*\n{recommendations_text}"
                        }
                    },
                    {
                        "type": "actions",
                        "elements": [
                            {
                                "type": "button",
                                "text": {
                                    "type": "plain_text",
                                    "text": "Sentry 대시보드 열기",
                                    "emoji": True
                                },
                                "url": get_dashboard_url(),
                                "style": "danger" if overall_level >= 4 else "primary"
                            }
                        ]
                    },
                    {
                        "type": "context",
                        "elements": [
                            {
                                "type": "mrkdwn",
                                "text": f"_분석 시간: {kst_time.strftime('%Y-%m-%d %H:%M:%S')} KST_"
                            }
                        ]
                    }
                ]
            }
        ]
    }

    return message


def format_summary_report(analysis_result: Dict) -> Dict:
    """요약 리포트 메시지 포맷팅 (정상 상태용)"""

    release_version = analysis_result['release_version']
    risk = analysis_result['risk_assessment']
    current = analysis_result['current_analysis']
    period = analysis_result['analysis_period']

    # 경과 시간 표시
    period_desc = period['description']

    # 상태 이모지 및 색상 (정상 상태)
    main_emoji = "✅"
    status_text = risk['status']
    color = "good"

    # 다음 체크 시간
    next_check = get_next_check_time(period_desc)

    test_indicator = " [테스트]" if TEST_MODE else ""

    message = {
        "attachments": [
            {
                "color": color,
                "blocks": [
                    {
                        "type": "header",
                        "text": {
                            "type": "plain_text",
                            "text": f"📊 {release_version} 모니터링 리포트{test_indicator}",
                            "emoji": True
                        }
                    },
                    {
                        "type": "context",
                        "elements": [
                            {
                                "type": "mrkdwn",
                                "text": f"📅 {period_desc} | 🌍 {ENVIRONMENT} | 상태: {main_emoji} {status_text}"
                            }
                        ]
                    },
                    {
                        "type": "divider"
                    },
                    {
                        "type": "section",
                        "fields": [
                            {
                                "type": "mrkdwn",
                                "text": f"*총 크래시 발생*\n{current['total_crashes']}건"
                            },
                            {
                                "type": "mrkdwn",
                                "text": f"*Fatal 크래시*\n{current['total_fatal']}건"
                            },
                            {
                                "type": "mrkdwn",
                                "text": f"*영향 사용자*\n{current['affected_users']}명"
                            },
                            {
                                "type": "mrkdwn",
                                "text": f"*크래시 이슈 종류*\n{current['total_issues']}개"
                            }
                        ]
                    },
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"*🎯 다음 체크:* {next_check}"
                        }
                    },
                    {
                        "type": "actions",
                        "elements": [
                            {
                                "type": "button",
                                "text": {
                                    "type": "plain_text",
                                    "text": "Sentry 대시보드 열기",
                                    "emoji": True
                                },
                                "url": get_dashboard_url(),
                                "style": "primary"
                            }
                        ]
                    }
                ]
            }
        ]
    }

    return message


def format_monitoring_complete(release_version: str, final_stats: Dict) -> Dict:
    """모니터링 완료 메시지"""

    test_indicator = " [테스트]" if TEST_MODE else ""

    # 한국 시간으로 변환
    kst_time = utc_to_kst(datetime.now(timezone.utc))

    message = {
        "attachments": [
            {
                "color": "good",
                "blocks": [
                    {
                        "type": "header",
                        "text": {
                            "type": "plain_text",
                            "text": f"🎉 {release_version} 모니터링 완료{test_indicator}",
                            "emoji": True
                        }
                    },
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"📅 *모니터링 기간:* 7일간\n"
                                    f"📊 *총 크래시:* {final_stats.get('total_crashes', 0)}건\n"
                                    f"👥 *총 영향 사용자:* {final_stats.get('total_users', 0)}명\n"
                                    f"🏆 *최종 상태:* 안정적\n"
                                    f"🌍 *환경:* {ENVIRONMENT}"
                        }
                    },
                    {
                        "type": "context",
                        "elements": [
                            {
                                "type": "mrkdwn",
                                "text": f"_완료 시간: {kst_time.strftime('%Y-%m-%d %H:%M:%S')} KST_"
                            }
                        ]
                    }
                ]
            }
        ]
    }

    return message


def get_dashboard_url() -> str:
    """대시보드 URL 생성"""
    if DASH_BOARD_ID:
        return f"https://sentry.io/organizations/{ORG_SLUG}/dashboard/{DASH_BOARD_ID}/"
    else:
        return f"https://sentry.io/organizations/{ORG_SLUG}/dashboards/"


def get_next_check_time(period_desc: str) -> str:
    """다음 체크 시간 안내"""
    if "집중 모니터링" in period_desc or "릴리즈 후" in period_desc:
        return "15분 후 (집중 모니터링)"
    elif "최근 24시간" in period_desc:
        return "1시간 후 (일반 모니터링)"
    else:
        return "다음 스케줄에 따라"


def send_level_alert(analysis_result: Dict) -> bool:
    """레벨 기반 알림 전송"""
    message = format_level_alert(analysis_result)
    return send_to_slack(message)


def send_summary_report(analysis_result: Dict) -> bool:
    """요약 리포트 전송"""
    message = format_summary_report(analysis_result)
    return send_to_slack(message)


def send_completion_notice(release_version: str, final_stats: Dict) -> bool:
    """완료 알림 전송"""
    message = format_monitoring_complete(release_version, final_stats)
    return send_to_slack(message)


def send_error_alert(error_message: str, context: Dict = None) -> bool:
    """오류 알림 전송"""
    test_indicator = " [테스트]" if TEST_MODE else ""

    # 한국 시간으로 변환
    kst_time = utc_to_kst(datetime.now(timezone.utc))

    message = {
        "text": f"🚨 릴리즈 모니터링 오류{test_indicator}: {error_message}",
        "blocks": [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*🚨 릴리즈 모니터링 오류{test_indicator}*\n\n"
                            f"• 오류: `{error_message}`\n"
                            f"• 시간: {kst_time.strftime('%Y-%m-%d %H:%M:%S')} KST\n"
                            f"• 환경: {'로컬 테스트' if is_local_environment() else 'GitHub Actions'}"
                }
            }
        ]
    }

    if context:
        context_text = "\n".join([f"• {k}: {v}" for k, v in context.items()])
        message["blocks"][0]["text"]["text"] += f"\n\n*컨텍스트:*\n{context_text}"

    return send_to_slack(message)
