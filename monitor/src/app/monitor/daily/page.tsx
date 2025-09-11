'use client'

import React, { useState, useEffect, useCallback } from 'react'
import SlackPreview from '@/lib/SlackPreview'
import { formatKST } from '@/lib/utils'
import Link from 'next/link'
import { formatKST, formatExecutionTime, validateTimeFormat, formatTimeKorean } from '@/lib/utils'
import type { 
  ReportExecution, 
  ReportSettings, 
  GenerateDailyReportRequest,
  WeekDay
} from '@/lib/reports/types'

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

// 상태별 스타일
const getStatusStyle = (status: string) => {
  switch (status) {
    case 'success':
      return { color: 'var(--ok)', backgroundColor: 'rgba(34, 197, 94, 0.1)' }
    case 'error':
      return { color: 'var(--danger)', backgroundColor: 'rgba(239, 68, 68, 0.1)' }
    case 'running':
      return { color: 'var(--warning)', backgroundColor: 'rgba(245, 158, 11, 0.1)' }
    default:
      return { color: 'var(--muted)', backgroundColor: 'rgba(154, 164, 178, 0.1)' }
  }
}

const getStatusText = (status: string) => {
  switch (status) {
    case 'success': return '✅ 성공'
    case 'error': return '❌ 실패'
    case 'running': return '🔄 실행중'
    default: return status
  }
}

// 요일 정보
const weekDays = [
  { key: 'mon' as WeekDay, label: '월' },
  { key: 'tue' as WeekDay, label: '화' },
  { key: 'wed' as WeekDay, label: '수' },
  { key: 'thu' as WeekDay, label: '목' },
  { key: 'fri' as WeekDay, label: '금' },
  { key: 'sat' as WeekDay, label: '토' },
  { key: 'sun' as WeekDay, label: '일' },
]


const thStyle: React.CSSProperties = {
  padding: '12px 14px',
  textAlign: 'left',
  fontWeight: 700,
  fontSize: '12px',
  letterSpacing: '0.2px',
  background: '#0f1524',
  color: 'var(--muted)',
  borderBottom: '1px solid var(--border)',
}

const tdStyle: React.CSSProperties = {
  padding: '12px 14px',
  fontSize: '13px',
  verticalAlign: 'middle',
  borderBottom: '1px solid var(--border)',
}

export default function DailyReportPage() {
  // 상태 관리
  const [reports, setReports] = useState<ReportExecution[]>([])
  const [, setSettings] = useState<ReportSettings | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  
  // 테스트 실행 상태
  const [generateLoading, setGenerateLoading] = useState(false)
  const [generateMessage, setGenerateMessage] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [includeAI, setIncludeAI] = useState(true)
  const [sendSlack, setSendSlack] = useState(true)
  const [isTestMode, setIsTestMode] = useState(false)
  const [platform, setPlatform] = useState<'android' | 'ios' | 'all'>('all')
  
  // 설정 변경 상태
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsMessage, setSettingsMessage] = useState('')
  const [autoEnabled, setAutoEnabled] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(true)
  const [scheduleDays, setScheduleDays] = useState<WeekDay[]>(['mon', 'tue', 'wed', 'thu', 'fri'])
  const [scheduleTime, setScheduleTime] = useState('09:00')
  const [settingsTestMode, setSettingsTestMode] = useState(false)
  
  // 결과 모달 상태
  const [selectedReport, setSelectedReport] = useState<ReportExecution | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [expandedSections, setExpandedSections] = useState({
    logs: false,
    data: false,
    slack: false
  })
  // Cron 상태(디버그)
  const [cronStatus, setCronStatus] = useState<any>(null)
  const [cronLoading, setCronLoading] = useState(false)
  // 플랫폼 필터 (히스토리)
  const [historyPlatform, setHistoryPlatform] = useState<'all' | 'android' | 'ios'>('all')
  // Top5 상태
  const [topAndroid, setTopAndroid] = useState<any[]>([])
  const [topIOS, setTopIOS] = useState<any[]>([])
  const [topLoading, setTopLoading] = useState(false)
  const [issueModal, setIssueModal] = useState<{ open: boolean; item?: any; platform?: 'android'|'ios'; dateKey?: string }>(()=>({ open: false }))
  const [issueAnalysis, setIssueAnalysis] = useState<any | null>(null)
  const [issueLoading, setIssueLoading] = useState(false)
  // 날짜 표시를 KST 기준으로 변환 (YYYY-MM-DD)
  const toKstDate = (dateStr?: string) => {
    if (!dateStr) return '-'
    // start_date/target_date는 'YYYY-MM-DD' 형태이므로 자정 UTC를 붙여 KST로 보정
    const kst = formatKST(`${dateStr}T00:00:00Z`)
    return kst.slice(0, 10)
  }

  // 히스토리 조회
  const fetchReports = useCallback(async () => {
    setLoading(true)
    setError('')
    
    try {
      const q = historyPlatform === 'all' ? '' : `&platform=${historyPlatform}`
      const response = await fetch(`/api/reports/daily/history?limit=30${q}`)
      const result: ApiResponse<{ reports: ReportExecution[] }> = await response.json()
      
      if (!result.success || !result.data) {
        throw new Error(result.error || '리포트 히스토리 조회 실패')
      }
      
      setReports(result.data.reports)
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류')
    } finally {
      setLoading(false)
    }
  }, [historyPlatform])

  // 설정 조회
  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/reports/daily/settings')
      const result: ApiResponse<{ settings: ReportSettings }> = await response.json()
      
      if (result.success && result.data) {
        setSettings(result.data.settings)
        setAutoEnabled(result.data.settings.auto_enabled)
        setAiEnabled(result.data.settings.ai_enabled)
        setScheduleDays(result.data.settings.schedule_days || ['mon', 'tue', 'wed', 'thu', 'fri'])
        setScheduleTime(result.data.settings.schedule_time || '09:00')
        setSettingsTestMode(result.data.settings.is_test_mode || false)
      }
    } catch (err) {
      console.error('Failed to fetch settings:', err)
    }
  }, [])

  // 컴포넌트 마운트 시 데이터 로드
  useEffect(() => {
    fetchReports()
    fetchSettings()
    // 최신 Top5 로드
    const loadTop = async () => {
      setTopLoading(true)
      try {
        const [aRes, iRes] = await Promise.all([
          fetch('/api/reports/daily/top?platform=android').then(r=>r.json()),
          fetch('/api/reports/daily/top?platform=ios').then(r=>r.json())
        ])
        setTopAndroid(aRes?.data?.top || [])
        setTopIOS(iRes?.data?.top || [])
      } catch {}
      setTopLoading(false)
    }
    loadTop()
    // 초기 cron 상태 로드 + 60초마다 갱신
    const loadCron = async () => {
      setCronLoading(true)
      try {
        const res = await fetch('/api/debug/cron-status')
        const data = await res.json()
        if (data?.success) setCronStatus(data.data)
      } catch (e) {
        // noop
      } finally {
        setCronLoading(false)
      }
    }
    loadCron()
    const t = setInterval(loadCron, 60000)
    return () => clearInterval(t)
  }, [fetchReports, fetchSettings])

  const openIssue = async (item: any, platform: 'android'|'ios') => {
    setIssueModal({ open: true, item, platform })
    setIssueLoading(true)
    setIssueAnalysis(null)
    try {
      const dateKey = new Date().toISOString().slice(0,10) // 최신 기준 (정확한 키를 알 수 없을 때 API가 캐시 miss 시 새 분석)
      const res = await fetch(`/api/reports/issues/${encodeURIComponent(item.issueId)}/analysis?platform=${platform}&type=daily&dateKey=${dateKey}`)
      const j = await res.json()
      setIssueAnalysis(j?.data?.analysis || null)
    } catch {}
    setIssueLoading(false)
  }

  const runIssueAnalysis = async () => {
    if (!issueModal.item || !issueModal.platform) return
    setIssueLoading(true)
    setIssueAnalysis(null)
    try {
      const dateKey = new Date().toISOString().slice(0,10)
      const res = await fetch(`/api/reports/issues/${encodeURIComponent(issueModal.item.issueId)}/analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: issueModal.platform, type: 'daily', dateKey })
      })
      const j = await res.json()
      setIssueAnalysis(j?.data?.analysis || null)
    } catch {}
    setIssueLoading(false)
  }

  // 리포트 생성
  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault()
    
    setGenerateLoading(true)
    setGenerateMessage('')
    
    try {
      const request: GenerateDailyReportRequest = {
        targetDate: targetDate || undefined,
        sendSlack,
        includeAI,
        isTestMode,
        platform
      }
      
      const response = await fetch('/api/reports/daily/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
      })
      
      const result: ApiResponse<{ message: string; executionId: string }> = await response.json()
      
      if (!result.success) {
        throw new Error(result.error || '리포트 생성 실패')
      }
      
      setGenerateMessage(`✅ ${result.data?.message}`)
      
      // 히스토리 새로고침
      setTimeout(() => {
        fetchReports()
        setGenerateMessage('')
      }, 2000)
      
    } catch (err) {
      setGenerateMessage(`❌ ${err instanceof Error ? err.message : '알 수 없는 오류'}`)
    } finally {
      setGenerateLoading(false)
    }
  }

  // 설정 업데이트
  const handleSettingsUpdate = async () => {
    setSettingsLoading(true)
    setSettingsMessage('')
    
    // 시간 형식 검증
    if (!validateTimeFormat(scheduleTime)) {
      setSettingsMessage('❌ 올바른 시간 형식을 입력해주세요 (예: 09:00)')
      setSettingsLoading(false)
      setTimeout(() => setSettingsMessage(''), 5000)
      return
    }
    
    try {
      // 기존 설정 업데이트
      const settingsResponse = await fetch('/api/reports/daily/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auto_enabled: autoEnabled,
          ai_enabled: aiEnabled,
          schedule_days: scheduleDays,
          schedule_time: scheduleTime,
          is_test_mode: settingsTestMode
        })
      })
      
      const settingsResult: ApiResponse<{ settings: ReportSettings }> = await settingsResponse.json()
      
      if (!settingsResult.success) {
        throw new Error(settingsResult.error || '설정 업데이트 실패')
      }

      // QStash 스케줄 업데이트 (자동 스케줄이 활성화된 경우)
      if (autoEnabled) {
        const scheduleResponse = await fetch('/api/schedule/manage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reportType: 'daily',
            scheduleDays,
            scheduleTime
          })
        })

        const scheduleResult = await scheduleResponse.json()
        
        if (!scheduleResult.success) {
          console.warn('QStash 스케줄 업데이트 실패:', scheduleResult.error)
          // QStash 실패해도 설정 저장은 성공으로 처리
        }
      }
      
      setSettings(settingsResult.data!.settings)
      setSettingsMessage('✅ 설정이 성공적으로 저장되었습니다.')
      
      // 3초 후 메시지 자동 삭제
      setTimeout(() => {
        setSettingsMessage('')
      }, 3000)
      
    } catch (err) {
      setSettingsMessage(`❌ 설정 저장 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`)
      // 에러 메시지는 5초 후 삭제
      setTimeout(() => {
        setSettingsMessage('')
      }, 5000)
    } finally {
      setSettingsLoading(false)
    }
  }

  // 결과 보기
  const handleViewReport = (report: ReportExecution) => {
    setSelectedReport(report)
    setShowModal(true)
    // 모달 열 때마다 섹션 초기화
    setExpandedSections({
      logs: false,
      data: false,
      slack: false
    })
  }

  // 섹션 토글
  const toggleSection = (section: 'logs' | 'data' | 'slack') => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }))
  }

  // Slack 메시지 렌더링
  const renderSlackMessage = (reportData: any) => {
    if (!reportData) return '리포트 데이터가 없습니다.'
    
    try {
      let message = `📊 *일간 크래시 리포트 - ${selectedReport?.target_date}*\n\n`
      
      // 데이터 구조 디버깅을 위한 로그
      console.log('Report Data Structure:', reportData)
      
      // 다양한 데이터 구조에 대응
      let summary, topIssues, newIssues, resolvedIssues
      
      // reportData가 직접 데이터를 가지고 있는 경우
      if (reportData.summary || reportData.topIssues || reportData.total_events) {
        summary = reportData.summary || {
          totalEvents: reportData.total_events,
          totalIssues: reportData.total_issues,
          totalUsers: reportData.total_users,
          newIssues: reportData.new_issues_count,
          resolvedIssues: reportData.resolved_issues_count
        }
        topIssues = reportData.topIssues || reportData.top_issues || []
        newIssues = reportData.newIssues || reportData.new_issues || []
        resolvedIssues = reportData.resolvedIssues || reportData.resolved_issues || []
      }
      // reportData가 중첩된 구조인 경우 (data 속성 등)
      else if (reportData.data) {
        const data = reportData.data
        summary = data.summary || {
          totalEvents: data.total_events,
          totalIssues: data.total_issues,
          totalUsers: data.total_users,
          newIssues: data.new_issues_count,
          resolvedIssues: data.resolved_issues_count
        }
        topIssues = data.topIssues || data.top_issues || []
        newIssues = data.newIssues || data.new_issues || []
        resolvedIssues = data.resolvedIssues || data.resolved_issues || []
      }
      
      // 요약 섹션
      if (summary) {
        message += `🔢 *요약*\n`
        message += `• 총 이벤트: ${summary.totalEvents || summary.total_events || 0}건\n`
        message += `• 총 이슈: ${summary.totalIssues || summary.total_issues || 0}개\n`
        message += `• 영향받은 사용자: ${summary.totalUsers || summary.total_users || 0}명\n`
        message += `• 신규 이슈: ${summary.newIssues || summary.new_issues_count || 0}개\n`
        message += `• 해결된 이슈: ${summary.resolvedIssues || summary.resolved_issues_count || 0}개\n\n`
      }
      
      // 주요 이슈 섹션
      if (topIssues && topIssues.length > 0) {
        message += `🔥 *주요 이슈 (상위 ${Math.min(5, topIssues.length)}개)*\n`
        topIssues.slice(0, 5).forEach((issue: any, index: number) => {
          const title = issue.title || issue.culprit || issue.message || 'Unknown Error'
          const events = issue.events || issue.event_count || 0
          const users = issue.users || issue.user_count || 0
          message += `${index + 1}. ${title}\n`
          message += `   📈 ${events}건 | 👥 ${users}명\n`
        })
        message += '\n'
      }
      
      // 신규 이슈 섹션
      if (newIssues && newIssues.length > 0) {
        message += `🆕 *신규 이슈 (${newIssues.length}개)*\n`
        newIssues.slice(0, 3).forEach((issue: any) => {
          const title = issue.title || issue.culprit || issue.message || 'Unknown Error'
          message += `• ${title}\n`
        })
        message += '\n'
      }
      
      // 해결된 이슈 섹션
      if (resolvedIssues && resolvedIssues.length > 0) {
        message += `✅ *해결된 이슈 (${resolvedIssues.length}개)*\n`
        resolvedIssues.slice(0, 3).forEach((issue: any) => {
          const title = issue.title || issue.culprit || issue.message || 'Unknown Error'
          message += `• ${title}\n`
        })
        message += '\n'
      }
      
      // 데이터가 비어있는 경우
      if (!summary && (!topIssues || topIssues.length === 0) && (!newIssues || newIssues.length === 0)) {
        message += `📋 *데이터 구조*\n`
        message += `• 사용 가능한 키: ${Object.keys(reportData).join(', ')}\n\n`
        message += `⚠️ 표준 데이터 구조와 다릅니다. 실제 Slack 메시지는 다를 수 있습니다.`
      }
      
      return message
      
    } catch (error) {
      return `슬랙 메시지 미리보기 생성 오류: ${error}\n\n원본 데이터:\n${JSON.stringify(reportData, null, 2)}`
    }
  }

  // 요일 토글
  const toggleScheduleDay = (day: WeekDay) => {
    setScheduleDays(prev => {
      if (prev.includes(day)) {
        return prev.filter(d => d !== day)
      } else {
        return [...prev, day].sort((a, b) => {
          const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
          return order.indexOf(a) - order.indexOf(b)
        })
      }
    })
  }

  // 어제 날짜 기본값
  useEffect(() => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    setTargetDate(yesterday.toISOString().split('T')[0])
  }, [])

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h1 className="h1">📊 일간 리포트</h1>
          <p className="muted">
            Sentry 일간 크래시 리포트를 생성하고 관리합니다. 자동 스케줄 설정에 따라 실행되며, 수동 생성도 가능합니다.
          </p>
        </div>
        
        {/* 페이지 네비게이션 탭 */}
        <div className="nav-tabs">
          <Link href="/monitor" className="btn ghost" style={{ fontSize: '12px', padding: '8px 16px' }}>
            릴리즈 모니터링
          </Link>
          <Link href="/monitor/daily" className="btn ghost" style={{ fontSize: '12px', padding: '8px 16px', backgroundColor: 'rgba(255, 255, 255, 0.1)' }}>
            일간 리포트
          </Link>
          <Link href="/monitor/weekly" className="btn ghost" style={{ fontSize: '12px', padding: '8px 16px' }}>
            주간 리포트
          </Link>
        </div>
      </div>

      {/* 테스트 실행 섹션 */}
      {/* Top 5 이슈 (플랫폼별) */}
      <div className="card">
        <h2 className="h2">🏅 플랫폼별 Top 5 이슈 (최근 리포트)</h2>
        {topLoading ? (
          <div className="muted">불러오는 중…</div>
        ) : (
          <div className="row" style={{ gap: 24, alignItems: 'flex-start' }}>
            {[{key:'android', label:'🤖 ANDROID', data: topAndroid},{key:'ios', label:'🍎 iOS', data: topIOS}].map(col => (
              <div key={col.key} style={{ flex: 1, minWidth: 320 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>{col.label}</div>
                {col.data.length === 0 ? (
                  <div className="muted">데이터가 없습니다.</div>
                ) : (
                  <div>
                    {col.data.map((it:any, idx:number)=>(
                      <div key={it.issueId || idx} style={{
                        display:'flex', justifyContent:'space-between', alignItems:'center',
                        border:'1px solid var(--border)', borderRadius:8, padding:'10px 12px', marginBottom:8
                      }}>
                        <div style={{ maxWidth:'70%' }}>
                          <div style={{ fontWeight:600, fontSize:13, marginBottom:4 }}>{idx+1}. {it.title}</div>
                          <div className="muted" style={{ fontSize:12 }}>📈 {it.events}건 {it.users!=null?`· 👥 ${it.users}명`:''}</div>
                        </div>
                        <div style={{ display:'flex', gap:8 }}>
                          {it.link && (
                            <a href={it.link} target="_blank" rel="noreferrer" className="btn ghost" style={{ fontSize:11, padding:'6px 10px' }}>Sentry</a>
                          )}
                          <button className="btn ghost" style={{ fontSize:11, padding:'6px 10px' }} onClick={()=>openIssue(it, col.key as any)}>상세보기</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card">
        <h2 className="h2">🧪 테스트 실행</h2>
        
        <form onSubmit={handleGenerate}>
          <div className="row responsive">
            {/* 플랫폼 선택 */}
            <label>플랫폼</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input type="radio" name="platform" value="all" checked={platform === 'all'} onChange={() => setPlatform('all')} /> 전체
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input type="radio" name="platform" value="android" checked={platform === 'android'} onChange={() => setPlatform('android')} /> Android
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input type="radio" name="platform" value="ios" checked={platform === 'ios'} onChange={() => setPlatform('ios')} /> iOS
              </label>
            </div>
            <label>분석 날짜 (기본: 어제)</label>
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  checked={sendSlack}
                  onChange={(e) => setSendSlack(e.target.checked)}
                />
                Slack 전송
              </label>
              
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  checked={includeAI}
                  onChange={(e) => setIncludeAI(e.target.checked)}
                />
                AI 분석 포함
              </label>
              
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  checked={isTestMode}
                  onChange={(e) => setIsTestMode(e.target.checked)}
                />
                🧪 테스트 모드
              </label>
            </div>
            
            <button 
              type="submit" 
              className="btn ok"
              disabled={generateLoading}
            >
              {generateLoading ? '생성 중...' : '일간 리포트 생성'}
            </button>
          </div>
          
          {generateMessage && (
            <div className="row" style={{ marginTop: '6px' }}>
              <span className="muted">{generateMessage}</span>
            </div>
          )}
        </form>
      </div>

      {/* 자동 스케줄 설정 */}
      <div className="card">
        <h2 className="h2">⚙️ 자동 스케줄 설정</h2>
        {/* 실행 상태 표시 */}
        <div className="muted" style={{ marginBottom: 12 }}>
          {cronLoading ? '스케줄 상태 불러오는 중…' : (
            cronStatus ? (
              <>
                <div>현재 시간(KST): {cronStatus.currentTime?.time} ({cronStatus.currentTime?.day?.toUpperCase()})</div>
                <div>
                  오늘 실행 여부: {cronStatus.dailyReport?.shouldRunToday ? '예' : '아니오'} · 시간 일치: {cronStatus.dailyReport?.timeMatch ? '예' : '아니오'} · 설정 시간: {cronStatus.dailyReport?.scheduleTime}
                </div>
                {cronStatus.dailyReport?.recentExecutions?.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    최근 실행: {cronStatus.dailyReport.recentExecutions.map((r: any) => r.createdAtKST || r.createdAt?.slice(0,16).replace('T',' ')).join(', ')}
                  </div>
                )}
              </>
            ) : '스케줄 상태 정보를 가져오지 못했습니다.'
          )}
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="row" style={{ alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                checked={autoEnabled}
                onChange={(e) => setAutoEnabled(e.target.checked)}
              />
              자동 실행 활성화
            </label>
            
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                checked={aiEnabled}
                onChange={(e) => setAiEnabled(e.target.checked)}
              />
              AI 분석 포함
            </label>
            
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                checked={settingsTestMode}
                onChange={(e) => setSettingsTestMode(e.target.checked)}
              />
              🧪 테스트 모드
            </label>
          </div>

          {/* 요일 선택 */}
          {autoEnabled && (
            <div>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '600' }}>
              실행 요일 선택
            </label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {weekDays.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleScheduleDay(key)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '20px',
                      border: '1px solid var(--border)',
                      backgroundColor: scheduleDays.includes(key) ? 'var(--ok)' : 'transparent',
                      color: scheduleDays.includes(key) ? 'white' : 'var(--text)',
                      fontSize: '12px',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {scheduleDays.length === 0 && (
                <p style={{ fontSize: '12px', color: 'var(--danger)', marginTop: '4px' }}>
                  최소 1개 이상의 요일을 선택해주세요.
                </p>
              )}
              
              {/* 시간 설정 */}
              <div style={{ marginTop: '12px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '600' }}>
                  실행 시간
                </label>
                <input
                  type="time"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  style={{
                    padding: '10px 14px',
                    borderRadius: '6px',
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--bg)',
                    color: 'var(--text)',
                    fontSize: '15px',
                    width: '160px',
                    minWidth: '160px'
                  }}
                />
                <span style={{ fontSize: '12px', color: 'var(--muted)', marginLeft: '8px' }}>
                  {validateTimeFormat(scheduleTime) ? `${formatTimeKorean(scheduleTime)} (KST)` : '(KST 기준)'}
                </span>
              </div>
            </div>
          )}
          
          <div className="row" style={{ alignItems: 'center', gap: '12px' }}>
            <button
              onClick={handleSettingsUpdate}
              disabled={settingsLoading || (autoEnabled && scheduleDays.length === 0) || !validateTimeFormat(scheduleTime)}
              className="btn ghost"
            >
              {settingsLoading ? '저장 중...' : '설정 저장'}
            </button>
            
            {settingsMessage && (
              <span 
                style={{
                  fontSize: '13px',
                  color: settingsMessage.startsWith('✅') ? 'var(--ok)' : 'var(--danger)',
                  fontWeight: '500'
                }}
              >
                {settingsMessage}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 히스토리 섹션 */}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="h2">📋 실행 히스토리</h2>
          <div className="row" style={{ gap: 12, alignItems: 'center' }}>
            <label className="row" style={{ gap: 6 }}>
              <span className="muted">플랫폼</span>
              <select value={historyPlatform} onChange={(e) => setHistoryPlatform(e.target.value as any)}>
                <option value="all">전체</option>
                <option value="android">Android</option>
                <option value="ios">iOS</option>
              </select>
            </label>
            <button onClick={fetchReports} disabled={loading} className="btn ghost">
              {loading ? '새로고침 중...' : '새로고침'}
            </button>
          </div>
        </div>

        {error && (
          <div className="muted" style={{ color: 'var(--danger)' }}>⚠️ {error}</div>
        )}

        {reports.length === 0 ? (
          <div className="muted" style={{ textAlign: 'center', padding: '40px 0' }}>
            {loading ? '로딩 중...' : '리포트 히스토리가 없습니다.'}
          </div>
        ) : (
          <>
            {/* 데스크톱 테이블 */}
            <div className="table-container table-mobile-cards" style={{ marginTop: '16px' }}>
            <table className="table-responsive">
              <thead>
                <tr>
                  <th style={thStyle}>분석 날짜</th>
                  <th style={thStyle}>플랫폼</th>
                  <th style={thStyle}>상태</th>
                  <th style={thStyle}>실행 방식</th>
                  <th style={thStyle}>실행 시간</th>
                  <th style={thStyle}>Slack 전송</th>
                  <th style={thStyle}>생성 일시</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>액션</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => {
                  const statusStyle = getStatusStyle(report.status)
                  return (
                    <tr key={report.id}>
                      <td style={tdStyle}>{toKstDate(report.target_date)}</td>
                      <td style={tdStyle}>{report.platform ? report.platform.toUpperCase() : '-'}</td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            ...statusStyle,
                            padding: '4px 8px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: 600,
                          }}
                        >
                          {getStatusText(report.status)}
                        </span>
                      </td>
                      <td style={tdStyle}>{report.trigger_type === 'scheduled' ? '자동' : '수동'}</td>
                      <td style={tdStyle}>{formatExecutionTime(report.execution_time_ms)}</td>
                      <td style={tdStyle}>{report.slack_sent ? '✅' : '❌'}</td>
                      <td style={tdStyle}>{formatKST(report.created_at)}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <button
                          onClick={() => handleViewReport(report)}
                          className="btn ghost"
                          style={{ fontSize: '11px', padding: '6px 12px' }}
                        >
                          결과 보기
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* 모바일 카드 */}
          <div className="mobile-cards" style={{ marginTop: '16px' }}>
            {reports.map((report) => {
              const statusStyle = getStatusStyle(report.status)
              return (
                <div key={report.id} className="mobile-card">
                  <div className="mobile-card-header">
                    <span
                      style={{
                        ...statusStyle,
                        padding: '4px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: 600,
                      }}
                    >
                      {getStatusText(report.status)}
                    </span>
                    <button
                      onClick={() => handleViewReport(report)}
                      className="btn ghost"
                      style={{ fontSize: '11px', padding: '6px 12px' }}
                    >
                      결과 보기
                    </button>
                  </div>
                  <div className="mobile-card-content">
                    <div className="mobile-field">
                      <span className="mobile-field-label">분석 날짜</span>
                      <span className="mobile-field-value">{toKstDate(report.target_date)}</span>
                    </div>
                    <div className="mobile-field">
                      <span className="mobile-field-label">플랫폼</span>
                      <span className="mobile-field-value">{report.platform ? report.platform.toUpperCase() : '-'}</span>
                    </div>
                    <div className="mobile-field">
                      <span className="mobile-field-label">실행 방식</span>
                      <span className="mobile-field-value">{report.trigger_type === 'scheduled' ? '자동' : '수동'}</span>
                    </div>
                    <div className="mobile-field">
                      <span className="mobile-field-label">실행 시간</span>
                      <span className="mobile-field-value">{formatExecutionTime(report.execution_time_ms)}</span>
                    </div>
                    <div className="mobile-field">
                      <span className="mobile-field-label">Slack 전송</span>
                      <span className="mobile-field-value">{report.slack_sent ? '✅' : '❌'}</span>
                    </div>
                    <div className="mobile-field">
                      <span className="mobile-field-label">생성 일시</span>
                      <span className="mobile-field-value">{formatKST(report.created_at)}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          </>
        )}
      </div>

      {/* 결과 보기 모달 */}
      {/* 이슈 상세 모달 */}
      {issueModal.open && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}>
          <div style={{ background:'var(--bg)', border:'1px solid var(--border)', borderRadius:12, padding:20, width:'90%', maxWidth:800, maxHeight:'80vh', overflow:'auto' }}>
            <div className="row" style={{ justifyContent:'space-between', alignItems:'center' }}>
              <h3 style={{ margin:0 }}>이슈 상세</h3>
              <button className="btn ghost" onClick={()=>setIssueModal({ open:false })}>✕</button>
            </div>
            {issueModal.item && (
              <div style={{ marginTop:12 }}>
                <div style={{ fontWeight:600, marginBottom:6 }}>{issueModal.item.title}</div>
                <div className="muted" style={{ fontSize:12, marginBottom:10 }}>📈 {issueModal.item.events}건 {issueModal.item.users!=null?`· 👥 ${issueModal.item.users}명`:''}</div>
                <div className="row" style={{ gap:8, marginBottom:12 }}>
                  {issueModal.item.link && <a className="btn ghost" href={issueModal.item.link} target="_blank" rel="noreferrer">Sentry에서 열기</a>}
                  <button className="btn ok" onClick={runIssueAnalysis} disabled={issueLoading}>{issueLoading?'분석 중…':'AI 분석'}</button>
                </div>
                {issueAnalysis && (
                  <details open style={{ marginTop:8 }}>
                    <summary style={{ cursor:'pointer', fontWeight:600 }}>AI 분석 결과</summary>
                    <pre style={{ whiteSpace:'pre-wrap', lineHeight:1.5 }}>{issueAnalysis.summary || JSON.stringify(issueAnalysis, null, 2)}</pre>
                  </details>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {showModal && selectedReport && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            padding: '24px',
            maxWidth: '800px',
            maxHeight: '80vh',
            overflow: 'auto',
            width: '90%'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0 }}>리포트 결과 - {selectedReport.target_date}</h3>
              <button 
                onClick={() => setShowModal(false)}
                className="btn ghost"
                style={{ padding: '4px 8px' }}
              >
                ✕
              </button>
            </div>
            
            <div style={{ marginBottom: '16px' }}>
              <p><strong>상태:</strong> {getStatusText(selectedReport.status)}</p>
              <p><strong>실행 방식:</strong> {selectedReport.trigger_type === 'scheduled' ? '자동' : '수동'}</p>
              <p><strong>실행 시간:</strong> {formatExecutionTime(selectedReport.execution_time_ms)}</p>
              <p><strong>Slack 전송:</strong> {selectedReport.slack_sent ? '✅ 성공' : '❌ 실패'}</p>
            </div>
            
            {selectedReport.error_message && (
              <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px' }}>
                <strong>오류 메시지:</strong><br />
                {selectedReport.error_message}
              </div>
            )}
            
            {/* 접을 수 있는 실행 로그 섹션 */}
            {/* @ts-ignore - execution_logs conditional rendering type issue */}
            {Array.isArray(selectedReport.execution_logs) && selectedReport.execution_logs.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <button
                  onClick={() => toggleSection('logs')}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    padding: '4px 0'
                  }}
                >
                  <span>{expandedSections.logs ? '▼' : '▶'}</span>
                  실행 로그
                </button>
                {expandedSections.logs && (
                  <pre style={{
                    marginTop: '8px',
                    padding: '12px',
                    backgroundColor: 'var(--bg-secondary)',
                    borderRadius: '8px',
                    fontSize: '11px',
                    overflow: 'auto',
                    maxHeight: '400px',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word'
                  }}>
                    {(selectedReport.execution_logs as string[]).join('\n')}
                  </pre>
                )}
              </div>
            )}

            {/* 접을 수 있는 리포트 데이터 섹션 */}
            {selectedReport.result_data && (
              <div style={{ marginBottom: '16px' }}>
                <button
                  onClick={() => toggleSection('data')}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    padding: '4px 0'
                  }}
                >
                  <span>{expandedSections.data ? '▼' : '▶'}</span>
                  리포트 데이터
                </button>
                {expandedSections.data && (
                  <pre style={{
                    marginTop: '8px',
                    padding: '12px',
                    backgroundColor: 'var(--bg-secondary)',
                    borderRadius: '8px',
                    fontSize: '12px',
                    overflow: 'auto',
                    maxHeight: '300px'
                  }}>
                    {JSON.stringify(selectedReport.result_data, null, 2)}
                  </pre>
                )}
              </div>
            )}

            {/* Slack 메시지 미리보기 섹션 */}
            {selectedReport.result_data && (
              <div style={{ marginBottom: '16px' }}>
                <button
                  onClick={() => toggleSection('slack')}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    padding: '4px 0'
                  }}
                >
                  <span>{expandedSections.slack ? '▼' : '▶'}</span>
                  Slack 메시지 미리보기
                </button>
                {expandedSections.slack && (
                  <div style={{
                    marginTop: '8px',
                    padding: '16px',
                    backgroundColor: '#f8f9fa',
                    border: '1px solid #e9ecef',
                    borderRadius: '8px',
                    color: '#212529',
                    fontSize: '13px',
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    lineHeight: '1.5',
                    whiteSpace: 'pre-wrap'
                  }}>
                    {(() => {
                      const blocks = (selectedReport.result_data as any)?.slack_blocks
                      if (Array.isArray(blocks) && blocks.length > 0) {
                        return <SlackPreview blocks={blocks} />
                      }
                      return renderSlackMessage(selectedReport.result_data)
                    })()}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
