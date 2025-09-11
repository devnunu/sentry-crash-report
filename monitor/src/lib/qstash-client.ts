import { Client, Receiver } from '@upstash/qstash'

export class QStashService {
  private client: Client
  private receiver: Receiver
  private baseUrl: string

  constructor() {
    const token = process.env.QSTASH_TOKEN
    const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY
    const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY

    if (!token || !currentSigningKey) {
      throw new Error('QSTASH_TOKEN and QSTASH_CURRENT_SIGNING_KEY are required')
    }

    this.client = new Client({ token })
    this.receiver = new Receiver({
      currentSigningKey,
      nextSigningKey
    })

    // 환경에 따른 베이스 URL 설정 (서버 우선)
    const appBase = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
    if (!appBase) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('APP_BASE_URL or NEXT_PUBLIC_APP_URL is required in production for QStash destination')
      }
      this.baseUrl = 'http://localhost:3000'
    } else {
      this.baseUrl = appBase
    }
  }

  // 스케줄 등록
  async scheduleJob(params: {
    jobId: string
    endpoint: string
    cron: string
    body?: any
    headers?: Record<string, string>
  }) {
    const { jobId, endpoint, cron, body = {}, headers = {} } = params
    
    console.log(`[QStash] Scheduling job: ${jobId}`)
    console.log(`  - Endpoint: ${this.baseUrl}${endpoint}`)
    console.log(`  - Cron: ${cron}`)

    try {
      const result = await this.client.schedules.create({
        destination: `${this.baseUrl}${endpoint}`,
        cron,
        body: JSON.stringify({
          ...body,
          qstashJobId: jobId,
          triggeredBy: 'qstash'
        }),
        headers: {
          'Content-Type': 'application/json',
          'X-QStash-Job-ID': jobId,
          ...headers
        }
      })

      // 일부 SDK/버전은 scheduleId 대신 schedule_id 를 반환할 수 있음
      const scheduleId = (result as any)?.scheduleId || (result as any)?.schedule_id || (result as any)?.id
      console.log(`[QStash] Job scheduled successfully: ${scheduleId}`, result)
      return {
        success: true,
        scheduleId,
        jobId,
        endpoint,
        cron
      }
    } catch (error) {
      console.error(`[QStash] Failed to schedule job ${jobId}:`, error)
      throw error
    }
  }

  // 스케줄 삭제
  async deleteSchedule(scheduleId: string) {
    console.log(`[QStash] Deleting schedule: ${scheduleId}`)
    
    try {
      await this.client.schedules.delete(scheduleId)
      console.log(`[QStash] Schedule deleted successfully: ${scheduleId}`)
      return { success: true, scheduleId }
    } catch (error) {
      console.error(`[QStash] Failed to delete schedule ${scheduleId}:`, error)
      throw error
    }
  }

  // 모든 스케줄 조회
  async listSchedules() {
    try {
      const schedules = await this.client.schedules.list()
      return schedules
    } catch (error) {
      console.error('[QStash] Failed to list schedules:', error)
      throw error
    }
  }

  // 특정 스케줄 조회
  async getSchedule(scheduleId: string) {
    try {
      const schedule = await this.client.schedules.get(scheduleId)
      return schedule
    } catch (error) {
      console.error(`[QStash] Failed to get schedule ${scheduleId}:`, error)
      throw error
    }
  }

  // webhook 서명 검증
  async verifySignature(signature: string, body: string, url?: string, method?: string): Promise<boolean> {
    try {
      const isValid = await this.receiver.verify({
        signature,
        body,
        url,
        method
      })
      return isValid
    } catch (error) {
      console.error('[QStash] Signature verification failed:', error)
      return false
    }
  }

  // 스케줄 업데이트 (기존 삭제 후 새로 생성)
  async updateSchedule(params: {
    oldScheduleId?: string
    jobId: string
    endpoint: string
    cron: string
    body?: any
    headers?: Record<string, string>
  }) {
    const { oldScheduleId, ...scheduleParams } = params

    try {
      // 기존 스케줄이 있으면 삭제
      if (oldScheduleId) {
        await this.deleteSchedule(oldScheduleId)
      }

      // 새 스케줄 등록
      return await this.scheduleJob(scheduleParams)
    } catch (error) {
      console.error(`[QStash] Failed to update schedule:`, error)
      throw error
    }
  }

  // 리포트별 스케줄 ID 생성
  getJobId(reportType: 'daily' | 'weekly' | 'monitor', suffix?: string): string {
    // Align IDs with webhook expectations
    // - daily => sentry-daily-report
    // - weekly => sentry-weekly-report
    // - monitor => sentry-monitor-tick (instead of previous "monitor-report")
    const base = reportType === 'monitor' ? 'sentry-monitor-tick' : `sentry-${reportType}-report`
    return suffix ? `${base}-${suffix}` : base
  }

  // cron 표현식 생성 도우미
  buildCronExpression(days: string[], time: string): string {
    // 입력은 KST 기준(days, time). QStash는 UTC 기준으로 스케줄되므로 UTC로 변환한다.
    // KST(UTC+9) => UTC 변환: 시간에서 9를 빼고, 0~8시 구간은 전날로 이동.
    const [hh, mm] = time.split(':').map(Number)
    let utcHour = hh - 9
    const crossesPrevDay = utcHour < 0
    if (crossesPrevDay) {
      utcHour += 24
    }

    // 요일 매핑 (0=일요일)
    const dayMapping: Record<string, number> = {
      'sun': 0, 'mon': 1, 'tue': 2, 'wed': 3,
      'thu': 4, 'fri': 5, 'sat': 6
    }

    // KST 요일을 UTC 요일로 보정
    // 예: KST 월 00:50 => UTC 일 15:50 (전날)
    const utcDays = days
      .map(d => dayMapping[d])
      .map(kstDay => (kstDay + (crossesPrevDay ? -1 : 0) + 7) % 7)
      .sort((a, b) => a - b)

    const dayString = utcDays.join(',')
    // cron: 분 시 일 월 요일 (UTC)
    return `${mm} ${utcHour} * * ${dayString}`
  }
}

// 싱글톤 인스턴스
export const qstashService = new QStashService()
