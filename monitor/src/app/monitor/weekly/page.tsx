'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { formatKST, formatExecutionTime, validateTimeFormat, formatTimeKorean } from '@/lib/utils'
import type { 
  ReportExecution, 
  ReportSettings, 
  GenerateWeeklyReportRequest,
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

export default function WeeklyReportPage() {
  // 상태 관리
  const [reports, setReports] = useState<ReportExecution[]>([])
  const [, setSettings] = useState<ReportSettings | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  
  // 테스트 실행 상태
  const [generateLoading, setGenerateLoading] = useState(false)
  const [generateMessage, setGenerateMessage] = useState('')
  const [targetWeek, setTargetWeek] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [dateMode, setDateMode] = useState<'week' | 'range'>('week')
  const [includeAI, setIncludeAI] = useState(true)
  const [sendSlack, setSendSlack] = useState(true)
  
  // 설정 변경 상태
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsMessage, setSettingsMessage] = useState('')
  const [autoEnabled, setAutoEnabled] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(true)
  const [scheduleDays, setScheduleDays] = useState<WeekDay[]>(['mon'])
  const [scheduleTime, setScheduleTime] = useState('09:00')
  
  // 결과 모달 상태
  const [selectedReport, setSelectedReport] = useState<ReportExecution | null>(null)
  const [showModal, setShowModal] = useState(false)

  // 히스토리 조회
  const fetchReports = useCallback(async () => {
    setLoading(true)
    setError('')
    
    try {
      const response = await fetch('/api/reports/weekly/history?limit=30')
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
  }, [])

  // 설정 조회
  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/reports/weekly/settings')
      const result: ApiResponse<{ settings: ReportSettings }> = await response.json()
      
      if (result.success && result.data) {
        setSettings(result.data.settings)
        setAutoEnabled(result.data.settings.auto_enabled)
        setAiEnabled(result.data.settings.ai_enabled)
        setScheduleDays(result.data.settings.schedule_days || ['mon'])
        setScheduleTime(result.data.settings.schedule_time || '09:00')
      }
    } catch (err) {
      console.error('Failed to fetch settings:', err)
    }
  }, [])

  // 컴포넌트 마운트 시 데이터 로드
  useEffect(() => {
    fetchReports()
    fetchSettings()
  }, [fetchReports, fetchSettings])

  // 리포트 생성
  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault()
    
    setGenerateLoading(true)
    setGenerateMessage('')
    
    try {
      const request: GenerateWeeklyReportRequest = {
        sendSlack,
        includeAI
      }
      
      if (dateMode === 'week' && targetWeek) {
        request.targetWeek = targetWeek
      } else if (dateMode === 'range' && startDate && endDate) {
        request.startDate = startDate
        request.endDate = endDate
      }
      
      const response = await fetch('/api/reports/weekly/generate', {
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
      const response = await fetch('/api/reports/weekly/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auto_enabled: autoEnabled,
          ai_enabled: aiEnabled,
          schedule_days: scheduleDays,
          schedule_time: scheduleTime
        })
      })
      
      const result: ApiResponse<{ settings: ReportSettings }> = await response.json()
      
      if (!result.success) {
        throw new Error(result.error || '설정 업데이트 실패')
      }
      
      setSettings(result.data!.settings)
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

  // 지난주 월요일 기본값
  useEffect(() => {
    const getLastMonday = () => {
      const today = new Date()
      const dayOfWeek = today.getDay()
      const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1 // 일요일이면 6일, 아니면 현재요일-1
      const lastMonday = new Date(today)
      lastMonday.setDate(today.getDate() - daysToSubtract - 7) // 이번주 월요일에서 7일 더 빼서 지난주 월요일
      return lastMonday.toISOString().split('T')[0]
    }
    
    setTargetWeek(getLastMonday())
  }, [])

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h1 className="h1">📈 주간 리포트</h1>
          <p className="muted">
            Sentry 주간 크래시 리포트를 생성하고 관리합니다. 
            매주 월요일 오전 9시에 자동으로 실행되며, 수동으로도 생성할 수 있습니다.
          </p>
        </div>
        
        {/* 페이지 네비게이션 탭 */}
        <div className="nav-tabs">
          <Link href="/monitor" className="btn ghost" style={{ fontSize: '12px', padding: '8px 16px' }}>
            릴리즈 모니터링
          </Link>
          <Link href="/monitor/daily" className="btn ghost" style={{ fontSize: '12px', padding: '8px 16px' }}>
            일간 리포트
          </Link>
          <Link href="/monitor/weekly" className="btn ghost" style={{ fontSize: '12px', padding: '8px 16px', backgroundColor: 'rgba(255, 255, 255, 0.1)' }}>
            주간 리포트
          </Link>
        </div>
      </div>

      {/* 테스트 실행 섹션 */}
      <div className="card">
        <h2 className="h2">🧪 테스트 실행</h2>
        
        <form onSubmit={handleGenerate}>
          <div className="row responsive">
            <div style={{ display: 'flex', gap: '20px', alignItems: 'center', marginBottom: '16px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="radio"
                  name="dateMode"
                  checked={dateMode === 'week'}
                  onChange={() => setDateMode('week')}
                />
                주차별 (월요일 기준)
              </label>
              
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="radio"
                  name="dateMode"
                  checked={dateMode === 'range'}
                  onChange={() => setDateMode('range')}
                />
                기간 지정
              </label>
            </div>
            
            {dateMode === 'week' ? (
              <div>
                <label>분석 주차 (월요일 날짜, 기본: 지난주)</label>
                <input
                  type="date"
                  value={targetWeek}
                  onChange={(e) => setTargetWeek(e.target.value)}
                />
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                <div>
                  <label>시작 날짜</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <label>종료 날짜</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>
            )}
            
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
            </div>
            
            <button 
              type="submit" 
              className="btn ok"
              disabled={generateLoading}
            >
              {generateLoading ? '생성 중...' : '주간 리포트 생성'}
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
          </div>

          {/* 요일 선택 */}
          {autoEnabled && (
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '600' }}>
                실행 요일 선택 (오전 9시 기준)
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
          <button
            onClick={fetchReports}
            disabled={loading}
            className="btn ghost"
          >
            {loading ? '새로고침 중...' : '새로고침'}
          </button>
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
                  <th style={thStyle}>분석 기간</th>
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
                      <td style={tdStyle}>
                        {report.target_date 
                          ? `${report.target_date} 주차`
                          : `${report.start_date} ~ ${report.end_date}`
                        }
                      </td>
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
                      <span className="mobile-field-label">분석 기간</span>
                      <span className="mobile-field-value">
                        {report.target_date 
                          ? `${report.target_date} 주차`
                          : `${report.start_date} ~ ${report.end_date}`
                        }
                      </span>
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
              <h3 style={{ margin: 0 }}>
                리포트 결과 - {selectedReport.target_date 
                  ? `${selectedReport.target_date} 주차`
                  : `${selectedReport.start_date} ~ ${selectedReport.end_date}`
                }
              </h3>
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
            
            {selectedReport.execution_logs && selectedReport.execution_logs.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <strong>실행 로그:</strong>
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
                  {selectedReport.execution_logs.join('\n')}
                </pre>
              </div>
            )}

            {selectedReport.result_data && (
              <div style={{ marginBottom: '16px' }}>
                <strong>리포트 데이터:</strong>
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
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}