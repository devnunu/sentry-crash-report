'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { formatKST, formatExecutionTime } from '@/lib/utils'
import type { 
  ReportExecution, 
  ReportSettings, 
  GenerateDailyReportRequest,
  DailyReportData,
  AIAnalysis
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

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'separate',
  borderSpacing: 0,
  minWidth: '800px',
}

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
  const [settings, setSettings] = useState<ReportSettings | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  
  // 테스트 실행 상태
  const [generateLoading, setGenerateLoading] = useState(false)
  const [generateMessage, setGenerateMessage] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [includeAI, setIncludeAI] = useState(true)
  const [sendSlack, setSendSlack] = useState(true)
  
  // 설정 변경 상태
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [autoEnabled, setAutoEnabled] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(true)
  
  // 결과 모달 상태
  const [selectedReport, setSelectedReport] = useState<ReportExecution | null>(null)
  const [showModal, setShowModal] = useState(false)

  // 히스토리 조회
  const fetchReports = useCallback(async () => {
    setLoading(true)
    setError('')
    
    try {
      const response = await fetch('/api/reports/daily/history?limit=30')
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
      const response = await fetch('/api/reports/daily/settings')
      const result: ApiResponse<{ settings: ReportSettings }> = await response.json()
      
      if (result.success && result.data) {
        setSettings(result.data.settings)
        setAutoEnabled(result.data.settings.auto_enabled)
        setAiEnabled(result.data.settings.ai_enabled)
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
      const request: GenerateDailyReportRequest = {
        targetDate: targetDate || undefined,
        sendSlack,
        includeAI
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
    
    try {
      const response = await fetch('/api/reports/daily/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auto_enabled: autoEnabled,
          ai_enabled: aiEnabled
        })
      })
      
      const result: ApiResponse<{ settings: ReportSettings }> = await response.json()
      
      if (!result.success) {
        throw new Error(result.error || '설정 업데이트 실패')
      }
      
      setSettings(result.data!.settings)
      
    } catch (err) {
      alert(`설정 업데이트 실패: ${err instanceof Error ? err.message : '알 수 없는 오류'}`)
    } finally {
      setSettingsLoading(false)
    }
  }

  // 결과 보기
  const handleViewReport = (report: ReportExecution) => {
    setSelectedReport(report)
    setShowModal(true)
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
            Sentry 일간 크래시 리포트를 생성하고 관리합니다. 
            화수목금 오전 9시에 자동으로 실행되며, 수동으로도 생성할 수 있습니다.
          </p>
        </div>
        
        {/* 페이지 네비게이션 탭 */}
        <div style={{ display: 'flex', gap: '8px' }}>
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
      <div className="card">
        <h2 className="h2">🧪 테스트 실행</h2>
        
        <form onSubmit={handleGenerate}>
          <div className="row">
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
        
        <div className="row" style={{ alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={autoEnabled}
              onChange={(e) => setAutoEnabled(e.target.checked)}
            />
            자동 실행 (화수목금 오전 9시)
          </label>
          
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={aiEnabled}
              onChange={(e) => setAiEnabled(e.target.checked)}
            />
            AI 분석 포함
          </label>
          
          <button
            onClick={handleSettingsUpdate}
            disabled={settingsLoading}
            className="btn ghost"
          >
            {settingsLoading ? '저장 중...' : '설정 저장'}
          </button>
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
          <div
            style={{
              width: '100%',
              overflowX: 'auto',
              marginTop: '16px',
              border: '1px solid var(--border)',
              borderRadius: '12px',
            }}
          >
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>분석 날짜</th>
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
                      <td style={tdStyle}>{report.target_date}</td>
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