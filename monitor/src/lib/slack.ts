import { formatKST, getSlackWebhookUrl } from './utils'
import type { WindowAggregation, TopIssue, Platform } from './types'

interface SlackBlock {
  type: string
  [key: string]: unknown
}

interface SlackMessage {
  blocks: SlackBlock[]
}

// 델타 변화를 나타내는 이모지
function getDeltaEmoji(delta: number): string {
  if (delta > 0) return ':small_red_triangle:'
  if (delta < 0) return ':small_red_triangle_down:'
  return '—'
}

// 텍스트를 볼드체로 만들기
function bold(text: string): string {
  return `*${text}*`
}

// 긴 제목 자르기
function truncateTitle(title: string | undefined, maxLength: number = 90): string {
  if (!title) return '(제목 없음)'
  return title.length <= maxLength ? title : title.substring(0, maxLength - 1) + '…'
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

  // Slack 메시지 블록 생성
  buildSlackBlocks(
    releaseLabel: string,
    windowLabel: string,
    snapshot: WindowAggregation,
    deltas: WindowAggregation,
    totals: WindowAggregation,
    topIssues: TopIssue[],
    actionUrls: { dashboard: string; issues: string },
    cadenceLabel: string
  ): SlackBlock[] {
    const blocks: SlackBlock[] = []

    // 헤더
    blocks.push({
      type: 'header',
      text: {
        type: 'plain_text',
        text: `🚀 릴리즈 모니터링 — ${releaseLabel}`,
        emoji: true
      }
    })

    // 컨텍스트 정보
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `*집계 구간*: ${windowLabel} · *주기*: ${cadenceLabel}`
        }
      ]
    })

    // 스냅샷 요약
    const summaryLines = [
      bold(':memo: 스냅샷 요약'),
      this.buildMetricLine('💥 *총 이벤트*', totals.events, snapshot.events, deltas.events, '건', cadenceLabel),
      this.buildMetricLine('🐞 *총 유니크 이슈*', totals.issues, snapshot.issues, deltas.issues, '개', cadenceLabel),
      this.buildMetricLine('👥 *총 영향 사용자*', totals.users, snapshot.users, deltas.users, '명', cadenceLabel)
    ]

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: summaryLines.join('\n')
      }
    })

    // Top 이슈 목록
    if (topIssues.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: bold(':sports_medal: 윈도우 Top5 이슈')
        }
      })

      const issueLines = topIssues.map(issue => {
        const title = truncateTitle(issue.title)
        return `• <${issue.link}|${title}> · ${issue.events}건 · ${issue.users}명`
      })

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: issueLines.join('\n')
        }
      })
    }

    // 액션 버튼
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '📊 대시보드 열기'
          },
          url: actionUrls.dashboard
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '🔎 이 구간 이슈 보기'
          },
          url: actionUrls.issues
        }
      ]
    })

    return blocks
  }

  // 메트릭 라인 생성
  private buildMetricLine(
    name: string,
    total: number,
    windowValue: number,
    delta: number,
    unit: string,
    cadenceLabel: string
  ): string {
    const totalFormatted = total.toLocaleString()
    const windowFormatted = windowValue.toLocaleString()
    const deltaEmoji = getDeltaEmoji(delta)
    const deltaSign = delta > 0 ? '+' : delta < 0 ? '-' : ''
    const deltaText = delta !== 0 ? `${deltaSign}${Math.abs(delta)}${unit}` : `0${unit}`
    const trendText = delta === 0
      ? '변화 없음'
      : `${deltaEmoji} ${deltaText}`

    return `• ${name}: ${totalFormatted}${unit}  · 최근 ${cadenceLabel} ${windowFormatted}${unit} (${trendText})`
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

  // 모니터링 리포트 전송 (편의 메서드)
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
    const releaseLabel = `${platform.toUpperCase()} ${matchedRelease}`
    const windowLabel = `${formatKST(windowStart.toISOString())} ~ ${formatKST(windowEnd.toISOString())}`

    const blocks = this.buildSlackBlocks(
      releaseLabel,
      windowLabel,
      snapshot,
      deltas,
      totals,
      topIssues,
      actionUrls,
      cadenceLabel
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
    const cadenceText = customIntervalMinutes
      ? `${customIntervalMinutes}분 간격`
      : '1시간 간격'

    const blocks: SlackBlock[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🚀 새로운 릴리즈 모니터링 시작',
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `*플랫폼*: ${platform.toUpperCase()}`,
            `*베이스 릴리즈*: ${baseRelease}`,
            `*모니터 ID*: ${monitorId}`,
            `*만료일*: ${formatKST(expiresAt.toISOString())}`,
            `*주기*: ${cadenceText}`,
            `*모드*: ${isTestMode ? '테스트' : '운영'}`
          ].join('\n')
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: isTestMode
              ? '테스트 모드는 지정한 간격(1~60분)으로 실행됩니다.'
              : '운영 모드는 1시간 간격으로 실행됩니다.'
          }
        ]
      }
    ]

    await this.sendMessage(blocks)
  }

  // 모니터링 종료 알림
  async sendStopNotification(
    platform: string,
    baseRelease: string,
    monitorId: string,
    reason: 'manual' | 'expired'
  ): Promise<void> {
    const reasonText = reason === 'manual' ? '수동 중단' : '만료로 인한 자동 중단'
    
    const blocks: SlackBlock[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🛑 릴리즈 모니터링 종료',
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `*플랫폼*: ${platform.toUpperCase()}`,
            `*베이스 릴리즈*: ${baseRelease}`,
            `*모니터 ID*: ${monitorId}`,
            `*종료 사유*: ${reasonText}`
          ].join('\n')
        }
      }
    ]

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
