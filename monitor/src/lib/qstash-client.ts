import { Client, Receiver } from '@upstash/qstash'

// 로컬 개발용 스케줄러 인터페이스
interface LocalScheduler {
  scheduleId: string
  jobId: string
  endpoint: string
  cron: string
  intervalId?: NodeJS.Timeout
}

export class QStashService {
  private client?: Client
  private receiver?: Receiver
  private baseUrl: string
  private isLocalMode: boolean
  private localSchedulers: Map<string, LocalScheduler> = new Map()

  constructor() {
    // 로컬 모드 확인 (환경 변수로 제어)
    this.isLocalMode = process.env.NODE_ENV === 'development' && process.env.QSTASH_LOCAL_MODE === 'true'
    
    if (!this.isLocalMode) {
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
    }

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

    console.log(`[QStash] Initialized in ${this.isLocalMode ? 'LOCAL' : 'CLOUD'} mode`)
  }

  // 로컬 모드용 cron 파서 (간단한 분 단위만 지원)
  private parseSimpleCron(cron: string): number {
    // "*/5 * * * *" -> 5분마다
    if (cron.startsWith('*/')) {
      const minutes = parseInt(cron.split(' ')[0].substring(2))
      return minutes * 60 * 1000 // 밀리초로 변환
    }
    // 기본값: 5분
    return 5 * 60 * 1000
  }

  // 로컬 모드용 HTTP 요청 실행
  private async executeLocalJob(scheduler: LocalScheduler, body: any) {
    try {
      console.log(`[QStash-Local] Executing job: ${scheduler.jobId}`)
      const response = await fetch(`${this.baseUrl}${scheduler.endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-QStash-Job-ID': scheduler.jobId
        },
        body: JSON.stringify({
          ...body,
          qstashJobId: scheduler.jobId,
          triggeredBy: 'qstash-local'
        })
      })
      console.log(`[QStash-Local] Job ${scheduler.jobId} response: ${response.status}`)
    } catch (error) {
      console.error(`[QStash-Local] Failed to execute job ${scheduler.jobId}:`, error)
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
    console.log(`  - Mode: ${this.isLocalMode ? 'LOCAL' : 'CLOUD'}`)

    if (this.isLocalMode) {
      // 로컬 모드: 단순 setInterval 사용
      const scheduleId = `local-${jobId}-${Date.now()}`
      const interval = this.parseSimpleCron(cron)
      
      const scheduler: LocalScheduler = {
        scheduleId,
        jobId,
        endpoint,
        cron
      }
      
      // 즉시 한 번 실행
      await this.executeLocalJob(scheduler, body)
      
      // 주기적 실행 설정
      scheduler.intervalId = setInterval(() => {
        this.executeLocalJob(scheduler, body)
      }, interval)
      
      this.localSchedulers.set(scheduleId, scheduler)
      
      console.log(`[QStash-Local] Job scheduled successfully: ${scheduleId} (every ${interval}ms)`)
      return {
        success: true,
        scheduleId,
        jobId,
        endpoint,
        cron
      }
    }

    // 클라우드 모드: 기존 QStash 사용
    if (!this.client) {
      throw new Error('QStash client not initialized')
    }

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
    
    if (this.isLocalMode) {
      // 로컬 모드: interval 정리
      const scheduler = this.localSchedulers.get(scheduleId)
      if (scheduler) {
        if (scheduler.intervalId) {
          clearInterval(scheduler.intervalId)
        }
        this.localSchedulers.delete(scheduleId)
        console.log(`[QStash-Local] Schedule deleted successfully: ${scheduleId}`)
        return { success: true, scheduleId }
      } else {
        console.log(`[QStash-Local] Schedule not found: ${scheduleId}`)
        return { success: false, scheduleId }
      }
    }

    // 클라우드 모드: 기존 QStash 사용
    if (!this.client) {
      throw new Error('QStash client not initialized')
    }
    
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
    if (this.isLocalMode) {
      // 로컬 모드: 메모리의 스케줄러 반환
      const schedules = Array.from(this.localSchedulers.values()).map(scheduler => ({
        scheduleId: scheduler.scheduleId,
        jobId: scheduler.jobId,
        destination: `${this.baseUrl}${scheduler.endpoint}`,
        cron: scheduler.cron,
        mode: 'local'
      }))
      return schedules
    }

    // 클라우드 모드: 기존 QStash 사용
    if (!this.client) {
      throw new Error('QStash client not initialized')
    }
    
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
    if (this.isLocalMode) {
      // 로컬 모드: 메모리에서 조회
      const scheduler = this.localSchedulers.get(scheduleId)
      if (scheduler) {
        return {
          scheduleId: scheduler.scheduleId,
          jobId: scheduler.jobId,
          destination: `${this.baseUrl}${scheduler.endpoint}`,
          cron: scheduler.cron,
          mode: 'local'
        }
      }
      throw new Error(`Schedule not found: ${scheduleId}`)
    }

    // 클라우드 모드: 기존 QStash 사용
    if (!this.client) {
      throw new Error('QStash client not initialized')
    }
    
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
    if (this.isLocalMode) {
      // 로컬 모드: 서명 검증 생략 (로컬 테스트용)
      console.log('[QStash-Local] Signature verification skipped in local mode')
      return true
    }

    // 클라우드 모드: 기존 QStash 사용
    if (!this.receiver) {
      throw new Error('QStash receiver not initialized')
    }
    
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
