import { supabaseAdmin } from './supabase'
import { v4 as uuidv4 } from 'uuid'
import { addDays } from 'date-fns'
import type { 
  MonitorSession, 
  MonitorHistory, 
  Platform, 
  MonitorStatus,
  WindowAggregation,
  TopIssue
} from './types'

export class DatabaseService {
  
  private ensureSupabaseAdmin() {
    if (!supabaseAdmin) {
      throw new Error('Supabase admin client is not configured. Please set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.')
    }
    return supabaseAdmin
  }
  
  // 모니터링 세션 생성
  async createMonitorSession(
    platform: Platform, 
    baseRelease: string, 
    days: number = 7,
    isTestMode: boolean = false
  ): Promise<MonitorSession> {
    const id = uuidv4()
    const now = new Date()
    const expiresAt = addDays(now, days)
    
    const { data, error } = await this.ensureSupabaseAdmin()
      .from('monitor_sessions')
      .insert({
        id,
        platform,
        base_release: baseRelease,
        status: 'active' as MonitorStatus,
        started_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        is_test_mode: isTestMode
      })
      .select()
      .single()
    
    if (error) {
      throw new Error(`Failed to create monitor session: ${error.message}`)
    }
    
    return data as MonitorSession
  }
  
  // 활성 모니터링 세션 목록 조회
  async getActiveMonitorSessions(): Promise<MonitorSession[]> {
    const { data, error } = await this.ensureSupabaseAdmin()
      .from('monitor_sessions')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
    
    if (error) {
      throw new Error(`Failed to get active monitors: ${error.message}`)
    }
    
    return data as MonitorSession[]
  }
  
  // 모든 모니터링 세션 조회 (상태별)
  async getMonitorSessions(status?: MonitorStatus): Promise<MonitorSession[]> {
    const admin = this.ensureSupabaseAdmin()
    let query = admin
      .from('monitor_sessions')
      .select('*')
    
    if (status) {
      query = query.eq('status', status)
    }
    
    const { data, error } = await query.order('created_at', { ascending: false })
    
    if (error) {
      throw new Error(`Failed to get monitor sessions: ${error.message}`)
    }
    
    return data as MonitorSession[]
  }
  
  // 특정 모니터링 세션 조회
  async getMonitorSession(id: string): Promise<MonitorSession | null> {
    const { data, error } = await this.ensureSupabaseAdmin()
      .from('monitor_sessions')
      .select('*')
      .eq('id', id)
      .single()
    
    if (error) {
      if (error.code === 'PGRST116') { // No rows returned
        return null
      }
      throw new Error(`Failed to get monitor session: ${error.message}`)
    }
    
    return data as MonitorSession
  }
  
  // 모니터링 세션 업데이트
  async updateMonitorSession(
    id: string, 
    updates: Partial<Omit<MonitorSession, 'id' | 'created_at' | 'updated_at'>>
  ): Promise<MonitorSession> {
    const { data, error } = await this.ensureSupabaseAdmin()
      .from('monitor_sessions')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    
    if (error) {
      throw new Error(`Failed to update monitor session: ${error.message}`)
    }
    
    return data as MonitorSession
  }
  
  // 모니터링 세션 중단
  async stopMonitorSession(id: string): Promise<MonitorSession> {
    return this.updateMonitorSession(id, { status: 'stopped' })
  }

  // 모니터 상태 업데이트
  async updateMonitorStatus(id: string, status: MonitorStatus): Promise<void> {
    const { error } = await this.ensureSupabaseAdmin()
      .from('monitor_sessions')
      .update({ status })
      .eq('id', id)

    if (error) {
      throw new Error(`Failed to update monitor status: ${error.message}`)
    }
  }

  // 모니터 메타데이터 업데이트
  async updateMonitorMetadata(id: string, metadata: any): Promise<void> {
    const { error } = await this.ensureSupabaseAdmin()
      .from('monitor_sessions')
      .update({ metadata })
      .eq('id', id)

    if (error) {
      throw new Error(`Failed to update monitor metadata: ${error.message}`)
    }
  }

  // 모니터 QStash 스케줄 ID 업데이트
  async updateMonitorQStashScheduleId(id: string, scheduleId: string): Promise<void> {
    const { error } = await this.ensureSupabaseAdmin()
      .from('monitor_sessions')
      .update({ qstash_schedule_id: scheduleId })
      .eq('id', id)

    if (error) {
      throw new Error(`Failed to update monitor QStash schedule ID: ${error.message}`)
    }
  }
  
  // 만료된 모니터 정리
  async cleanupExpiredMonitors(): Promise<number> {
    const admin = this.ensureSupabaseAdmin()
    const { error } = await admin.rpc('cleanup_expired_monitors')
    
    if (error) {
      throw new Error(`Failed to cleanup expired monitors: ${error.message}`)
    }
    
    // 업데이트된 행의 수를 반환하기 위해 다시 조회
    const { data } = await admin
      .from('monitor_sessions')
      .select('id')
      .eq('status', 'expired')
    
    return data?.length || 0
  }
  
  // 모니터링 히스토리 생성
  async createMonitorHistory(
    monitorId: string,
    windowStart: Date,
    windowEnd: Date,
    aggregation: WindowAggregation,
    topIssues: TopIssue[],
    slackSent: boolean = false
  ): Promise<MonitorHistory> {
    const { data, error } = await this.ensureSupabaseAdmin()
      .from('monitor_history')
      .insert({
        monitor_id: monitorId,
        window_start: windowStart.toISOString(),
        window_end: windowEnd.toISOString(),
        events_count: aggregation.events,
        issues_count: aggregation.issues,
        users_count: aggregation.users,
        top_issues: topIssues,
        slack_sent: slackSent
      })
      .select()
      .single()
    
    if (error) {
      throw new Error(`Failed to create monitor history: ${error.message}`)
    }
    
    return data as MonitorHistory
  }
  
  // 모니터링 히스토리 조회
  async getMonitorHistory(
    monitorId: string, 
    limit: number = 50
  ): Promise<MonitorHistory[]> {
    const { data, error } = await this.ensureSupabaseAdmin()
      .from('monitor_history')
      .select('*')
      .eq('monitor_id', monitorId)
      .order('executed_at', { ascending: false })
      .limit(limit)
    
    if (error) {
      throw new Error(`Failed to get monitor history: ${error.message}`)
    }
    
    return data as MonitorHistory[]
  }
  
  // 최근 모니터링 결과 조회 (델타 계산용)
  async getLastMonitorHistory(monitorId: string): Promise<MonitorHistory | null> {
    const { data, error } = await this.ensureSupabaseAdmin()
      .from('monitor_history')
      .select('*')
      .eq('monitor_id', monitorId)
      .order('executed_at', { ascending: false })
      .limit(1)
      .single()
    
    if (error) {
      if (error.code === 'PGRST116') { // No rows returned
        return null
      }
      throw new Error(`Failed to get last monitor history: ${error.message}`)
    }
    
    return data as MonitorHistory
  }
}

// 싱글톤 인스턴스 생성
export const db = new DatabaseService()