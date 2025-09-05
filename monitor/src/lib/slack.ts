import { formatKST } from './utils'
import type { WindowAggregation, TopIssue } from './types'

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
  private webhookUrl: string

  constructor() {
    this.webhookUrl = process.env.SLACK_MONITORING_WEBHOOK_URL || ''
  }

  private validateConfig(): void {
    if (!this.webhookUrl) {
      throw new Error('SLACK_MONITORING_WEBHOOK_URL environment variable is required')
    }
  }

  // Slack 메시지 블록 생성
  buildSlackBlocks(
    releaseLabel: string,
    windowLabel: string,
    snapshot: WindowAggregation,
    deltas: WindowAggregation,
    cumulative: WindowAggregation,
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
      this.buildMetricLine('💥 *이벤트*', snapshot.events, deltas.events, '건', cumulative.events),
      this.buildMetricLine('🐞 *유니크 이슈*', snapshot.issues, deltas.issues, '개', cumulative.issues),
      this.buildMetricLine('👥 *영향 사용자*', snapshot.users, deltas.users, '명', cumulative.users)
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
    current: number,
    delta: number,
    unit: string,
    cumulative: number
  ): string {
    const emoji = getDeltaEmoji(delta)
    const sign = delta !== 0 ? `${delta > 0 ? '+' : ''}${delta}${unit}` : `${delta}${unit}`
    return `• ${name}: ${current}${unit}  · 변화: ${emoji} ${sign}  · 누적: ${cumulative}${unit}`
  }

  // Slack 메시지 전송
  async sendMessage(blocks: SlackBlock[]): Promise<void> {
    this.validateConfig()

    const message: SlackMessage = { blocks }

    try {
      const response = await fetch(this.webhookUrl, {
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

      console.log('[Slack] ✅ 메시지 전송 완료')
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
    cumulative: WindowAggregation,
    topIssues: TopIssue[],
    actionUrls: { dashboard: string; issues: string },
    interval: '30m' | '1h'
  ): Promise<void> {
    const releaseLabel = `${platform.toUpperCase()} ${matchedRelease}`
    const windowLabel = `${formatKST(windowStart.toISOString())} ~ ${formatKST(windowEnd.toISOString())}`
    const cadenceLabel = interval === '30m' ? '30분' : '1시간'

    const blocks = this.buildSlackBlocks(
      releaseLabel,
      windowLabel,
      snapshot,
      deltas,
      cumulative,
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
    expiresAt: Date
  ): Promise<void> {
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
            `*만료일*: ${formatKST(expiresAt.toISOString())}`
          ].join('\n')
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '첫 24시간은 30분마다, 이후는 1시간마다 리포트를 받게 됩니다.'
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
}

// 싱글톤 인스턴스
export const slackService = new SlackService()