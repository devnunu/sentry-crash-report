import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

export interface NotificationConfig {
  slack?: {
    enabled: boolean
    webhookUrl?: string
    channel?: string
    mentionUsers?: string[]
  }
  email?: {
    enabled: boolean
    recipients?: string[]
    smtpConfig?: any
  }
  severity?: {
    critical: boolean
    high: boolean
    medium: boolean
    low: boolean
  }
}

export interface AnalysisResult {
  issueId: string
  shortId?: string
  title: string
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  category: string
  sentryUrl: string
  analysis: any
}

class NotificationService {
  private config: NotificationConfig

  constructor(config: NotificationConfig = {}) {
    this.config = {
      slack: { enabled: false },
      email: { enabled: false },
      severity: {
        critical: true,
        high: true,
        medium: false,
        low: false
      },
      ...config
    }
  }

  async sendSlackNotification(analysis: AnalysisResult): Promise<boolean> {
    if (!this.config.slack?.enabled || !this.config.slack.webhookUrl) {
      return false
    }

    try {
      const severityEmoji = {
        CRITICAL: '🚨',
        HIGH: '⚠️',
        MEDIUM: '⚠️', 
        LOW: '💡'
      }

      const severityColor = {
        CRITICAL: '#dc2626',
        HIGH: '#ea580c',
        MEDIUM: '#ca8a04',
        LOW: '#2563eb'
      }

      const mentions = this.config.slack.mentionUsers?.length 
        ? this.config.slack.mentionUsers.map(u => `<@${u}>`).join(' ')
        : ''

      const message = {
        channel: this.config.slack.channel || '#sentry-alerts',
        username: 'Sentry AI Monitor',
        icon_emoji: ':robot_face:',
        text: mentions ? `${mentions} 새로운 Sentry 이슈가 분석되었습니다.` : '새로운 Sentry 이슈가 분석되었습니다.',
        attachments: [
          {
            color: severityColor[analysis.severity],
            title: `${severityEmoji[analysis.severity]} ${analysis.title}`,
            title_link: analysis.sentryUrl,
            fields: [
              {
                title: 'Issue ID',
                value: analysis.shortId || analysis.issueId,
                short: true
              },
              {
                title: 'Severity',
                value: analysis.severity,
                short: true
              },
              {
                title: 'Category',
                value: analysis.category,
                short: true
              },
              {
                title: 'Root Cause',
                value: analysis.analysis?.rootCause || 'Analysis pending...',
                short: false
              }
            ],
            footer: 'Finda Sentry AI Monitor',
            footer_icon: 'https://sentry.io/favicon.ico',
            ts: Math.floor(Date.now() / 1000)
          }
        ]
      }

      const response = await fetch(this.config.slack.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(message)
      })

      if (!response.ok) {
        throw new Error(`Slack API error: ${response.status} - ${response.statusText}`)
      }

      console.log(`[Notifications] Slack notification sent for issue: ${analysis.shortId}`)
      return true

    } catch (error) {
      console.error('[Notifications] Failed to send Slack notification:', error)
      return false
    }
  }

  async sendEmailNotification(analysis: AnalysisResult): Promise<boolean> {
    if (!this.config.email?.enabled || !this.config.email.recipients?.length) {
      return false
    }

    try {
      // Email implementation would go here
      // This could use services like SendGrid, AWS SES, or SMTP
      console.log(`[Notifications] Email notification would be sent for issue: ${analysis.shortId}`)
      
      // For now, just log what would be sent
      const emailContent = {
        to: this.config.email.recipients,
        subject: `🚨 Sentry Alert: ${analysis.severity} - ${analysis.title}`,
        html: `
          <h2>새로운 Sentry 이슈가 발견되어 AI가 분석했습니다</h2>
          <p><strong>Issue ID:</strong> ${analysis.shortId || analysis.issueId}</p>
          <p><strong>Severity:</strong> ${analysis.severity}</p>
          <p><strong>Category:</strong> ${analysis.category}</p>
          <p><strong>Root Cause:</strong> ${analysis.analysis?.rootCause || 'Analysis pending...'}</p>
          <p><a href="${analysis.sentryUrl}" target="_blank">Sentry에서 보기</a></p>
          <hr>
          <p><small>Finda Sentry AI Monitor</small></p>
        `
      }

      console.log('[Notifications] Email content prepared:', emailContent)
      return true

    } catch (error) {
      console.error('[Notifications] Failed to send email notification:', error)
      return false
    }
  }

  shouldNotify(severity: string): boolean {
    const severityConfig = this.config.severity
    if (!severityConfig) return false

    switch (severity.toUpperCase()) {
      case 'CRITICAL': return severityConfig.critical
      case 'HIGH': return severityConfig.high  
      case 'MEDIUM': return severityConfig.medium
      case 'LOW': return severityConfig.low
      default: return false
    }
  }

  async notify(analysis: AnalysisResult): Promise<{slack: boolean, email: boolean}> {
    if (!this.shouldNotify(analysis.severity)) {
      console.log(`[Notifications] Skipping notification for ${analysis.severity} severity`)
      return { slack: false, email: false }
    }

    const results = {
      slack: false,
      email: false
    }

    // Send notifications in parallel
    const notifications = []

    if (this.config.slack?.enabled) {
      notifications.push(
        this.sendSlackNotification(analysis).then(success => {
          results.slack = success
        })
      )
    }

    if (this.config.email?.enabled) {
      notifications.push(
        this.sendEmailNotification(analysis).then(success => {
          results.email = success
        })
      )
    }

    await Promise.allSettled(notifications)

    // Log notification results
    await this.logNotification(analysis, results)

    return results
  }

  private async logNotification(analysis: AnalysisResult, results: {slack: boolean, email: boolean}): Promise<void> {
    try {
      await supabase
        .from('notification_logs')
        .insert({
          issue_id: analysis.issueId,
          issue_short_id: analysis.shortId,
          severity: analysis.severity,
          category: analysis.category,
          slack_sent: results.slack,
          email_sent: results.email,
          config_used: this.config,
          sent_at: new Date().toISOString()
        })
    } catch (error) {
      console.error('[Notifications] Failed to log notification:', error)
    }
  }
}

// Get notification config from environment or database
export async function getNotificationConfig(): Promise<NotificationConfig> {
  try {
    // Try to get from database first
    const { data } = await supabase
      .from('notification_config')
      .select('*')
      .single()

    if (data) {
      return data.config as NotificationConfig
    }
  } catch (error) {
    console.warn('[Notifications] Failed to get config from database:', error)
  }

  // Fallback to environment variables
  return {
    slack: {
      enabled: !!process.env.SLACK_WEBHOOK_URL,
      webhookUrl: process.env.SLACK_WEBHOOK_URL,
      channel: process.env.SLACK_CHANNEL || '#sentry-alerts',
      mentionUsers: process.env.SLACK_MENTION_USERS?.split(',') || []
    },
    email: {
      enabled: false,
      recipients: process.env.EMAIL_RECIPIENTS?.split(',') || []
    },
    severity: {
      critical: process.env.NOTIFY_CRITICAL !== 'false',
      high: process.env.NOTIFY_HIGH !== 'false', 
      medium: process.env.NOTIFY_MEDIUM === 'true',
      low: process.env.NOTIFY_LOW === 'true'
    }
  }
}

export async function sendNotification(analysis: AnalysisResult): Promise<{slack: boolean, email: boolean}> {
  const config = await getNotificationConfig()
  const notificationService = new NotificationService(config)
  return notificationService.notify(analysis)
}

export default NotificationService