import { supabaseAdmin } from '../supabase'
import type { ReportExecution, ReportSettings } from './types'

export class ReportsDatabaseService {
  
  private toKstDateString(date: Date): string {
    // KST = UTC+9, 저장은 'YYYY-MM-DD' (KST 기준 날짜)
    const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000)
    return kst.toISOString().split('T')[0]
  }

  // ----- Issue Analyses -----
  async getIssueAnalysis(
    platform: 'android' | 'ios',
    issueId: string,
    reportType: 'daily' | 'weekly',
    dateKey: string
  ): Promise<any | null> {
    const { data, error } = await this.ensureSupabaseAdmin()
      .from('issue_analyses')
      .select('*')
      .eq('platform', platform)
      .eq('issue_id', issueId)
      .eq('report_type', reportType)
      .eq('date_key', dateKey)
      .single()
    if (error) {
      if ((error as any).code === 'PGRST116') return null
      throw new Error(`Failed to get issue analysis: ${error.message}`)
    }
    return data
  }

  async upsertIssueAnalysis(
    platform: 'android' | 'ios',
    issueId: string,
    reportType: 'daily' | 'weekly',
    dateKey: string,
    analysis: any,
    promptDigest?: string
  ): Promise<any> {
    const { data, error } = await this.ensureSupabaseAdmin()
      .from('issue_analyses')
      .upsert({ platform, issue_id: issueId, report_type: reportType, date_key: dateKey, analysis, prompt_digest: promptDigest, updated_at: new Date().toISOString() }, { onConflict: 'platform,issue_id,report_type,date_key' })
      .select('*')
      .single()
    if (error) throw new Error(`Failed to upsert issue analysis: ${error.message}`)
    return data
  }
  
  private ensureSupabaseAdmin() {
    if (!supabaseAdmin) {
      throw new Error('Supabase admin client is not configured')
    }
    return supabaseAdmin
  }
  
  // 리포트 실행 기록 생성
  async createReportExecution(
    reportType: 'daily' | 'weekly',
    triggerType: 'scheduled' | 'manual',
    targetDate: Date,
    startDate: Date,
    endDate: Date,
    platform?: 'android' | 'ios'
  ): Promise<ReportExecution> {
    // 날짜 컬럼은 KST 기준의 'YYYY-MM-DD'로 저장
    const targetDateKst = this.toKstDateString(targetDate)
    const startDateKst = this.toKstDateString(startDate)
    const endDateKst = this.toKstDateString(endDate)
    const { data, error } = await this.ensureSupabaseAdmin()
      .from('report_executions')
      .insert({
        report_type: reportType,
        status: 'running',
        trigger_type: triggerType,
        target_date: targetDateKst,
        start_date: startDateKst,
        end_date: endDateKst,
        platform
      })
      .select()
      .single()
    
    if (error) {
      throw new Error(`Failed to create report execution: ${error.message}`)
    }
    
    return data as ReportExecution
  }
  
  // 리포트 실행 완료 처리
  async completeReportExecution(
    id: string,
    status: 'success' | 'error',
    resultData?: unknown,
    aiAnalysis?: unknown,
    slackSent: boolean = false,
    errorMessage?: string,
    executionTimeMs?: number,
    executionLogs?: string[]
  ): Promise<ReportExecution> {
    const updateData: any = {
      status,
      result_data: resultData,
      ai_analysis: aiAnalysis,
      slack_sent: slackSent,
      error_message: errorMessage,
      execution_time_ms: executionTimeMs
    }

    if (executionLogs) {
      updateData.execution_logs = executionLogs
    }

    const { data, error } = await this.ensureSupabaseAdmin()
      .from('report_executions')
      .update(updateData)
      .eq('id', id)
      .select()
      .single()
    
    if (error) {
      throw new Error(`Failed to complete report execution: ${error.message}`)
    }
    
    return data as ReportExecution
  }

  // 리포트 실행 기록 삭제
  async deleteReportExecution(id: string): Promise<void> {
    const { error } = await this.ensureSupabaseAdmin()
      .from('report_executions')
      .delete()
      .eq('id', id)

    if (error) {
      throw new Error(`Failed to delete report execution: ${error.message}`)
    }
  }

  // 리포트 실행 기록 조회
  async getReportExecutions(
    reportType?: 'daily' | 'weekly',
    limit: number = 30,
    offset: number = 0,
    platform?: 'android' | 'ios'
  ): Promise<ReportExecution[]> {
    let query = this.ensureSupabaseAdmin()
      .from('report_executions')
      .select('*')
    
    if (reportType) {
      query = query.eq('report_type', reportType)
    }
    if (platform) {
      query = query.eq('platform', platform)
    }
    
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)
    
    if (error) {
      throw new Error(`Failed to get report executions: ${error.message}`)
    }
    
    return data as ReportExecution[]
  }
  
  // 특정 리포트 실행 조회
  async getReportExecution(id: string): Promise<ReportExecution | null> {
    const { data, error } = await this.ensureSupabaseAdmin()
      .from('report_executions')
      .select('*')
      .eq('id', id)
      .single()
    
    if (error) {
      if (error.code === 'PGRST116') { // No rows returned
        return null
      }
      throw new Error(`Failed to get report execution: ${error.message}`)
    }
    
    return data as ReportExecution
  }
  
  // 리포트 설정 조회
  async getReportSettings(reportType: 'daily' | 'weekly'): Promise<ReportSettings | null> {
    const { data, error } = await this.ensureSupabaseAdmin()
      .from('report_settings')
      .select('*')
      .eq('report_type', reportType)
      .single()
    
    if (error) {
      if (error.code === 'PGRST116') { // No rows returned
        return null
      }
      throw new Error(`Failed to get report settings: ${error.message}`)
    }
    
    return data as ReportSettings
  }
  
  // 리포트 설정 업데이트
  async updateReportSettings(
    reportType: 'daily' | 'weekly',
    updates: Partial<Pick<ReportSettings, 'auto_enabled' | 'schedule_time' | 'schedule_days' | 'ai_enabled' | 'is_test_mode'>>
  ): Promise<ReportSettings> {
    const { data, error } = await this.ensureSupabaseAdmin()
      .from('report_settings')
      .update(updates)
      .eq('report_type', reportType)
      .select()
      .single()
    
    if (error) {
      throw new Error(`Failed to update report settings: ${error.message}`)
    }
    
    return data as ReportSettings
  }
  
  // 모든 활성화된 리포트 설정 조회
  async getActiveReportSettings(): Promise<ReportSettings[]> {
    const { data, error } = await this.ensureSupabaseAdmin()
      .from('report_settings')
      .select('*')
      .eq('auto_enabled', true)
    
    if (error) {
      throw new Error(`Failed to get active report settings: ${error.message}`)
    }
    
    return data as ReportSettings[]
  }
  
  // 날짜 범위로 리포트 이력 조회
  async getReportHistory(
    reportType: 'daily' | 'weekly',
    platform: 'android' | 'ios',
    limit: number = 30,
    offset: number = 0,
    startDate?: string,
    endDate?: string
  ): Promise<ReportExecution[]> {
    let query = this.ensureSupabaseAdmin()
      .from('report_executions')
      .select('*')
      .eq('report_type', reportType)
      .eq('platform', platform)

    // 날짜 범위 필터링 (target_date 기준)
    if (startDate) {
      query = query.gte('target_date', startDate)
    }
    if (endDate) {
      query = query.lte('target_date', endDate)
    }

    const { data, error } = await query
      .order('target_date', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      throw new Error(`Failed to get report history: ${error.message}`)
    }

    return data as ReportExecution[]
  }

  // 실행 통계 조회
  async getReportStats(
    reportType?: 'daily' | 'weekly',
    days: number = 30
  ): Promise<{
    total: number
    success: number
    error: number
    avgExecutionTime?: number
  }> {
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    let query = this.ensureSupabaseAdmin()
      .from('report_executions')
      .select('status, execution_time_ms')
      .gte('created_at', startDate.toISOString())

    if (reportType) {
      query = query.eq('report_type', reportType)
    }

    const { data, error } = await query

    if (error) {
      throw new Error(`Failed to get report stats: ${error.message}`)
    }

    const total = data.length
    const success = data.filter(r => r.status === 'success').length
    const errorCount = data.filter(r => r.status === 'error').length
    const executionTimes = data
      .filter(r => r.execution_time_ms != null)
      .map(r => r.execution_time_ms as number)

    const avgExecutionTime = executionTimes.length > 0
      ? Math.round(executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length)
      : undefined

    return {
      total,
      success,
      error: errorCount,
      avgExecutionTime
    }
  }
}

// 싱글톤 인스턴스
export const reportsDb = new ReportsDatabaseService()
