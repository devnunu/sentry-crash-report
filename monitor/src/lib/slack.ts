import { formatKST, getSlackWebhookUrl } from './utils'
import type { WindowAggregation, TopIssue, Platform } from './types'

interface SlackBlock {
  type: string
  [key: string]: unknown
}

interface SlackMessage {
  blocks: SlackBlock[]
}

// 환경 변수에서 웹 URL 가져오기
const WEB_URL = process.env.NEXT_PUBLIC_WEB_URL || 'http://localhost:3000'

// 텍스트를 볼드체로 만들기
function bold(text: string): string {
  return `*${text}*`
}

// 긴 제목 자르기
function truncateTitle(title: string | undefined, maxLength: number = 90): string {
  if (!title) return '(제목 없음)'
  return title.length <= maxLength ? title : title.substring(0, maxLength - 1) + '…'
}

// 짧은 날짜 포맷 (M/D)
function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

// 날짜 범위 포맷 (M/D ~ M/D)
function formatDateRange(start: string, end: string): string {
  return `${formatShortDate(start)} ~ ${formatShortDate(end)}`
}

// 경과 일수 계산
function getDaysElapsed(startDate: string): number {
  const start = new Date(startDate)
  const now = new Date()
  const diff = now.getTime() - start.getTime()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

// 진행률 계산
function getProgress(startDate: string, durationDays: number): number {
  const elapsed = getDaysElapsed(startDate)
  return Math.min(100, Math.round((elapsed / durationDays) * 100))
}

// ========== 심각도 판단 ==========

interface MonitorSnapshot {
  totalCrashes: number
  totalIssues: number
  totalUsers: number
  newIssues: number
  criticalIssues: number
  comparisonPct: number // 이전 버전 대비 증감률 (양수: 악화, 음수: 개선)
}

function calculateMonitorSeverity(snapshot: MonitorSnapshot): 'normal' | 'warning' | 'critical' {
  // Critical 조건
  if (snapshot.criticalIssues >= 2) return 'critical'
  if (snapshot.comparisonPct > 100) return 'critical' // 2배 이상 악화
  if (snapshot.totalCrashes >= 500) return 'critical' // 절대 건수

  // Warning 조건
  if (snapshot.newIssues >= 3) return 'warning'
  if (snapshot.comparisonPct > 30) return 'warning' // 30% 이상 악화
  if (snapshot.totalCrashes >= 100) return 'warning' // 절대 건수

  return 'normal'
}

// Top 이슈를 텍스트로 변환
function getTopIssuesText(topIssues: TopIssue[], limit: number): string {
  return topIssues
    .slice(0, limit)
    .map((issue, idx) => {
      const title = truncateTitle(issue.title, 60)
      return `${idx + 1}. <${issue.link}|${title}>\n   ${issue.events}건 · ${issue.users}명 영향`
    })
    .join('\n')
}

// Critical 이슈만 추출
function getCriticalIssuesText(topIssues: TopIssue[]): string {
  // TODO: 실제로는 이슈의 level이 'fatal'이거나 events >= 500인 것으로 필터링
  const critical = topIssues.filter(issue => issue.events >= 100)
  if (critical.length === 0) {
    return topIssues.length > 0 ? getTopIssuesText(topIssues, 2) : '확인된 Critical 이슈 없음'
  }
  return getTopIssuesText(critical, 2)
}

export class SlackService {
  private platform: Platform
  private isTestMode: boolean

  constructor(platform: Platform = 'android', isTestMode: boolean = false) {
    this.platform = platform
    this.isTestMode = isTestMode
  }

  private getWebhookUrl(isMonitoring: boolean = true, isReport: boolean = false): string {
    return getSlackWebhookUrl(this.platform, this.isTestMode, isMonitoring, isReport)
  }

  private validateConfig(isMonitoring: boolean = true, isReport: boolean = false): void {
    try {
      this.getWebhookUrl(isMonitoring, isReport)
    } catch (error) {
      const modeText = this.isTestMode ? '테스트' : '운영'
      const typeText = isReport ? '리포트' : (isMonitoring ? '모니터링' : '일반')
      throw new Error(`${modeText} 모드용 ${typeText} Slack 웹훅 URL이 설정되지 않았습니다: ${error}`)
    }
  }

  // ========== 패턴 1: 시작 알림 ==========
  buildStartNotification(
    platform: string,
    version: string,
    monitorId: string,
    endDate: string,
    durationDays: number
  ): SlackBlock[] {
    return [
      { type: 'divider' },
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🚀 버전 모니터링 시작',
          emoji: true
        }
      },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${bold(platform.toUpperCase() + ' ' + version)}\n📅 ${durationDays}일간 자동 모니터링 (~ ${formatShortDate(endDate)})`
        }
      },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: '💬 배포 직후 30분마다, 이후 1시간마다 리포트 발송'
        }]
      },
      {
        type: 'actions',
        elements: [{
          type: 'button',
          text: { type: 'plain_text', text: '📊 대시보드 보기' },
          url: `${WEB_URL}/monitor/version/${monitorId}`,
          style: 'primary'
        }]
      }
    ]
  }

  // ========== 패턴 2-4: 정기 리포트 (상태별) ==========
  buildPeriodicReport(
    platform: string,
    version: string,
    monitorId: string,
    startDate: string,
    durationDays: number,
    snapshot: MonitorSnapshot,
    topIssues: TopIssue[],
    severity: 'normal' | 'warning' | 'critical'
  ): SlackBlock[] {
    const config = {
      normal: {
        emoji: '✅',
        message: `${bold('💬 현재까지 안정적입니다')}\n총 ${snapshot.totalCrashes.toLocaleString()}건${snapshot.comparisonPct !== 0 ? ` (이전 버전 대비 ${Math.abs(snapshot.comparisonPct)}% 개선)` : ''}`,
        buttonStyle: 'primary' as const,
        issues: null,
        warning: null
      },
      warning: {
        emoji: '⚠️',
        message: `${bold('💬 주의가 필요합니다')}\n총 ${snapshot.totalCrashes.toLocaleString()}건 (이전 버전 대비 +${snapshot.comparisonPct}% 악화)`,
        buttonStyle: 'danger' as const,
        issues: `${bold('⚠️ 확인 필요')}\n${getTopIssuesText(topIssues, 2)}`,
        warning: null
      },
      critical: {
        emoji: '🚨',
        message: `${bold('💬 심각한 상황입니다')}\n총 ${snapshot.totalCrashes.toLocaleString()}건 (이전 버전 대비 +${snapshot.comparisonPct}% 악화)`,
        buttonStyle: 'danger' as const,
        issues: `${bold('🚨 즉시 확인 필요')}\n${getCriticalIssuesText(topIssues)}`,
        warning: '💡 롤백 검토를 권장합니다'
      }
    }

    const cfg = config[severity]
    const progress = getProgress(startDate, durationDays)
    const daysElapsed = getDaysElapsed(startDate)

    const blocks: SlackBlock[] = [
      { type: 'divider' },
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${cfg.emoji} ${platform.toUpperCase()} ${version} 모니터링`,
          emoji: true
        }
      },
      { type: 'divider' },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `📅 ${daysElapsed}일차 / ${durationDays}일 (${progress}%)`
        }]
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: cfg.message
        }
      }
    ]

    // Warning/Critical일 경우 이슈 추가
    if (cfg.issues) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: cfg.issues
        }
      })
    }

    // Critical일 경우 경고 추가
    if (cfg.warning) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: cfg.warning
        }
      })
    }

    blocks.push({
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: '📊 대시보드 보기' },
        url: `${WEB_URL}/monitor/version/${monitorId}`,
        style: cfg.buttonStyle
      }]
    })

    return blocks
  }

  // ========== 패턴 5: 완료 알림 ==========
  buildCompletionNotification(
    platform: string,
    version: string,
    monitorId: string,
    startDate: string,
    endDate: string,
    durationDays: number,
    finalSnapshot: MonitorSnapshot
  ): SlackBlock[] {
    const isStable = finalSnapshot.comparisonPct <= 0 || finalSnapshot.totalCrashes < 100

    return [
      { type: 'divider' },
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `✅ ${platform.toUpperCase()} ${version} 모니터링 완료`,
          emoji: true
        }
      },
      { type: 'divider' },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `📅 ${formatDateRange(startDate, endDate)} (${durationDays}일)`
        }]
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${bold('💬 최종 결과: ' + (isStable ? '안정적' : '주의 필요'))}\n총 ${finalSnapshot.totalCrashes.toLocaleString()}건${finalSnapshot.comparisonPct !== 0 ? ` (이전 버전 대비 ${finalSnapshot.comparisonPct > 0 ? '+' : ''}${finalSnapshot.comparisonPct}% ${finalSnapshot.comparisonPct > 0 ? '악화' : '개선'})` : ''}`
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: isStable
            ? '🎉 이 버전은 안정적으로 배포되었습니다'
            : '⚠️ 지속적인 모니터링이 필요합니다'
        }
      },
      {
        type: 'actions',
        elements: [{
          type: 'button',
          text: { type: 'plain_text', text: '📊 최종 리포트 보기' },
          url: `${WEB_URL}/monitor/version/${monitorId}`,
          style: 'primary'
        }]
      }
    ]
  }

  // Slack 메시지 전송
  async sendMessage(blocks: SlackBlock[], isMonitoring: boolean = true, isReport: boolean = false): Promise<void> {
    this.validateConfig(isMonitoring, isReport)
    const webhookUrl = this.getWebhookUrl(isMonitoring, isReport)

    const message: SlackMessage = { blocks }

    // 테스트 모드인 경우 메시지에 표시
    if (this.isTestMode) {
      message.blocks.unshift({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: ':warning: *테스트 모드* - 이 메시지는 테스트용입니다.'
          }
        ]
      })
    }

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(message),
        // Vercel 환경에서 timeout 설정
        signal: AbortSignal.timeout(30000)
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Slack webhook failed ${response.status}: ${errorText}`)
      }

      const modeText = this.isTestMode ? '[테스트]' : ''
      console.log(`[Slack] ✅ ${modeText} 메시지 전송 완료`)
    } catch (error) {
      console.error('[Slack] ❌ 메시지 전송 실패:', error)
      throw error
    }
  }

  // ========== 기존 API 호환성 유지 (deprecated) ==========

  // 모니터링 리포트 전송
  async sendMonitoringReport(
    platform: string,
    baseRelease: string,
    matchedRelease: string,
    windowStart: Date,
    windowEnd: Date,
    snapshot: WindowAggregation,
    deltas: WindowAggregation,
    totals: WindowAggregation,
    topIssues: TopIssue[],
    actionUrls: { dashboard: string; issues: string },
    cadenceLabel: string
  ): Promise<void> {
    // TODO: 이전 버전 데이터 조회하여 비교
    // 현재는 임시로 comparisonPct = 0으로 설정
    const monitorSnapshot: MonitorSnapshot = {
      totalCrashes: totals.events,
      totalIssues: totals.issues,
      totalUsers: totals.users,
      newIssues: 0, // TODO: 계산 필요
      criticalIssues: topIssues.filter(i => i.events >= 100).length,
      comparisonPct: 0 // TODO: 이전 버전과 비교
    }

    const severity = calculateMonitorSeverity(monitorSnapshot)

    // 임시 monitorId (실제로는 monitor.id 전달 필요)
    const monitorId = 'unknown'
    // 임시 startDate, durationDays (실제로는 monitor에서 가져와야 함)
    const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const durationDays = 7

    const blocks = this.buildPeriodicReport(
      platform,
      matchedRelease,
      monitorId,
      startDate,
      durationDays,
      monitorSnapshot,
      topIssues,
      severity
    )

    await this.sendMessage(blocks)
  }

  // 모니터링 시작 알림
  async sendStartNotification(
    platform: string,
    baseRelease: string,
    monitorId: string,
    expiresAt: Date,
    customIntervalMinutes?: number,
    isTestMode?: boolean
  ): Promise<void> {
    // 임시 durationDays 계산
    const durationDays = 7

    const blocks = this.buildStartNotification(
      platform,
      baseRelease,
      monitorId,
      expiresAt.toISOString(),
      durationDays
    )

    await this.sendMessage(blocks)
  }

  // 모니터링 종료 알림
  async sendStopNotification(
    platform: string,
    baseRelease: string,
    monitorId: string,
    reason: 'manual' | 'expired'
  ): Promise<void> {
    // 임시로 완료 알림 사용
    // TODO: reason이 'manual'일 경우 다른 메시지 표시
    const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const endDate = new Date().toISOString()
    const durationDays = 7

    const finalSnapshot: MonitorSnapshot = {
      totalCrashes: 0,
      totalIssues: 0,
      totalUsers: 0,
      newIssues: 0,
      criticalIssues: 0,
      comparisonPct: 0
    }

    const blocks = this.buildCompletionNotification(
      platform,
      baseRelease,
      monitorId,
      startDate,
      endDate,
      durationDays,
      finalSnapshot
    )

    await this.sendMessage(blocks)
  }

  // 리포트 메시지 전송 (편의 메서드)
  async sendReportMessage(blocks: SlackBlock[]): Promise<void> {
    await this.sendMessage(blocks, false, true) // isMonitoring: false, isReport: true
  }
}

// 플랫폼별 서비스 인스턴스 생성 함수
export function createSlackService(platform: Platform, isTestMode: boolean = false): SlackService {
  return new SlackService(platform, isTestMode)
}

// 기본 인스턴스 (Android, 운영 모드)
export const slackService = new SlackService('android', false)

// Export types for external use
export type { MonitorSnapshot }
export { calculateMonitorSeverity }
