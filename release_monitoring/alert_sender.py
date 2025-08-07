"""
알림 발송 관리 모듈
Slack 메시지 포맷팅 및 전송
"""

import json
from datetime import datetime, timezone
from typing import Dict

import requests

from config import SLACK_WEBHOOK, DASH_BOARD_ID, ORG_SLUG, ENVIRONMENT, TEST_MODE, is_local_environment


def send_to_slack(message: Dict) -> bool:
    """Slack으로 메시지 전송"""
    if not SLACK_WEBHOOK:
        print("⚠️ SLACK_WEBHOOK_URL이 설정되지 않아 Slack 전송을 건너뜁니다.")
        return True

    if TEST_MODE or is_local_environment():
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

def format_critical_alert(analysis_result: Dict) -> Dict:
    """Critical 알림 메시지 포맷팅 (Level 4-5)"""

    release_version = analysis_result['release_version']
    risk = analysis_result['risk_assessment']
    current = analysis_result['current_analysis']
    baseline = analysis_result['baseline_analysis']
    critical_issues = analysis_result['critical_issues']
    recommendations = analysis_result['recommendations']

    # 경과 시간 계산
    elapsed_hours = analysis_result['analysis_period']['hours']
    elapsed_text = f"{elapsed_hours:.0f}시간" if elapsed_hours >= 1 else f"{elapsed_hours*60:.0f}분"

    # 변화량 계산
    change_text = ""
    if baseline['total_crashes'] > 0:
        change = current['total_crashes'] - baseline['total_crashes']
        change_text = f" (이전 대비 {change:+d}건)"
    elif current['total_crashes'] > 0:
        change_text = f" (신규 발생)"

    # 상위 이슈 텍스트
    issues_text = ""
    for i, issue in enumerate(critical_issues[:3], 1):
        severity_emoji = "🔴" if issue['level'] == 'fatal' else "🟠"
        issues_text += f"{i}. {severity_emoji} <{issue['sentry_url']}|{issue['title']}>\n"
        issues_text += f"   - 발생: {issue['count']}건, 영향: {issue['users']}명\n"

    if not issues_text:
        issues_text = "상세 이슈 정보를 수집 중입니다."

    # 권장 조치 텍스트
    recommendations_text = "\n".join([f"• {rec}" for rec in recommendations[:4]])

    # 색상 결정
    color = "danger" if risk['level'] >= 4 else "warning"

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
                            "text": f"🚨 긴급: {release_version} 릴리즈 문제 감지{test_indicator}",
                            "emoji": True
                        }
                    },
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"📱 *버전:* {release_version} (배포 후 {elapsed_text})\n"
                                   f"⚠️ *위험도:* Level {risk['level']} ({risk['status']})\n"
                                   f"📊 *크래시:* {current['total_crashes']}건{change_text}\n"
                                   f"👥 *영향 사용자:* {current['affected_users']}명\n"
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
                                "style": "danger"
                            }
                        ]
                    },
                    {
                        "type": "context",
                        "elements": [
                            {
                                "type": "mrkdwn",
                                "text": f"_분석 시간: {datetime.now(timezone.utc).strftime('%H:%M:%S')} UTC_"
                            }
                        ]
                    }
                ]
            }
        ]
    }

    return message

def format_summary_report(analysis_result: Dict) -> Dict:
    """요약 리포트 메시지 포맷팅 (Level 1-3)"""

    release_version = analysis_result['release_version']
    risk = analysis_result['risk_assessment']
    current = analysis_result['current_analysis']
    baseline = analysis_result['baseline_analysis']

    # 경과 시간
    elapsed_hours = analysis_result['analysis_period']['hours']
    if elapsed_hours >= 24:
        elapsed_text = f"{elapsed_hours/24:.0f}일"
    elif elapsed_hours >= 1:
        elapsed_text = f"{elapsed_hours:.0f}시간"
    else:
        elapsed_text = f"{elapsed_hours*60:.0f}분"

    # 상태 이모지 및 색상
    status_info = {
        1: {"emoji": "✅", "color": "good"},
        2: {"emoji": "⚠️", "color": "warning"},
        3: {"emoji": "🔶", "color": "warning"}
    }

    info = status_info.get(risk['level'], {"emoji": "❓", "color": "warning"})

    # 변화 추세
    trend_emoji = get_trend_emoji(current['total_crashes'], baseline['total_crashes'])
    change_text = calculate_change_text(current['total_crashes'], baseline['total_crashes'])

    # 다음 체크 시간
    next_check = get_next_check_time(elapsed_hours)

    test_indicator = " [테스트]" if TEST_MODE else ""

    message = {
        "attachments": [
            {
                "color": info["color"],
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
                                "text": f"📅 배포 후 {elapsed_text} | 🌍 {ENVIRONMENT} | 상태: {info['emoji']} {risk['status']}"
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
                                "text": f"*크래시 발생*\n{current['total_crashes']}건 {trend_emoji}"
                            },
                            {
                                "type": "mrkdwn",
                                "text": f"*영향 사용자*\n{current['affected_users']}명"
                            },
                            {
                                "type": "mrkdwn",
                                "text": f"*크래시 이슈*\n{current['total_issues']}개"
                            },
                            {
                                "type": "mrkdwn",
                                "text": f"*위험도*\nLevel {risk['level']}"
                            }
                        ]
                    },
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"*📈 변화:* {change_text}\n*🎯 다음 체크:* {next_check}"
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
                                "text": f"_완료 시간: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')} UTC_"
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

def get_trend_emoji(current: int, previous: int) -> str:
    """증감 추세 이모지"""
    if current == 0 and previous == 0:
        return "➡️"
    elif current == 0:
        return "🎉"
    elif previous == 0:
        return "🚨"

    if previous > 0:
        change_percent = ((current - previous) / previous) * 100

        if change_percent <= -50:
            return "📉"
        elif change_percent <= -10:
            return "↘️"
        elif change_percent >= 50:
            return "📈"
        elif change_percent >= 10:
            return "↗️"

    return "➡️"

def calculate_change_text(current: int, previous: int) -> str:
    """변화량 텍스트 생성"""
    if previous == 0 and current == 0:
        return "변화 없음"
    elif previous == 0:
        return f"신규 발생 {current}건"
    elif current == 0:
        return f"완전 해결 (이전 {previous}건)"
    else:
        change = current - previous
        if change > 0:
            percent = (change / previous) * 100
            return f"증가 +{change}건 ({percent:+.0f}%)"
        elif change < 0:
            percent = (abs(change) / previous) * 100
            return f"감소 {change}건 (-{percent:.0f}%)"
        else:
            return "동일"

def get_next_check_time(elapsed_hours: float) -> str:
    """다음 체크 시간 안내"""
    if elapsed_hours < 6:
        return "15분 후 (집중 모니터링)"
    elif elapsed_hours < 24:
        return "1시간 후 (일반 모니터링)"
    elif elapsed_hours < 168:  # 7일
        return "24시간 후 (주기적 확인)"
    else:
        return "모니터링 완료 예정"

def send_critical_alert(analysis_result: Dict) -> bool:
    """Critical 알림 전송"""
    message = format_critical_alert(analysis_result)
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

    message = {
        "text": f"🚨 릴리즈 모니터링 오류{test_indicator}: {error_message}",
        "blocks": [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"*🚨 릴리즈 모니터링 오류{test_indicator}*\n\n"
                           f"• 오류: `{error_message}`\n"
                           f"• 시간: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')} UTC\n"
                           f"• 환경: {'로컬 테스트' if is_local_environment() else 'GitHub Actions'}"
                }
            }
        ]
    }

    if context:
        context_text = "\n".join([f"• {k}: {v}" for k, v in context.items()])
        message["blocks"][0]["text"]["text"] += f"\n\n*컨텍스트:*\n{context_text}"

    return send_to_slack(message)