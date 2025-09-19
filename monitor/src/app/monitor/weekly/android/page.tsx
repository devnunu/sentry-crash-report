'use client'

import React, { useState, useEffect, useCallback } from 'react'
import SlackPreview from '@/lib/SlackPreview'
import { Button, Card, Group, Modal, ScrollArea, Select, SegmentedControl, Stack, Table, Text, Title, useMantineTheme } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { formatKST, formatExecutionTime } from '@/lib/utils'
import TableWrapper from '@/components/TableWrapper'
import StatusBadge from '@/components/StatusBadge'
import SectionToggle from '@/components/SectionToggle'
import { useMediaQuery } from '@mantine/hooks'
import StatsCards from '@/components/StatsCards'
import type { 
  ReportExecution, 
  ReportSettings
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
      return { color: 'var(--warn)', backgroundColor: 'rgba(245, 158, 11, 0.1)' }
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

const getStatusBadge = (status: string): { color: string; label: string } => {
  switch (status) {
    case 'success':
      return { color: 'green', label: '성공' }
    case 'error':
      return { color: 'red', label: '실패' }
    case 'running':
      return { color: 'yellow', label: '실행중' }
    default:
      return { color: 'gray', label: status }
  }
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

export default function WeeklyAndroidReportPage() {
  const theme = useMantineTheme()
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`)
  
  // 상태 관리
  const [, setSettings] = useState<ReportSettings | null>(null)
  
  
  
  // 결과 모달 상태
  const [selectedReport, setSelectedReport] = useState<ReportExecution | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [expandedSections, setExpandedSections] = useState({
    logs: false,
    data: false,
    slack: false
  })
  // 플랫폼 필터 (히스토리)
  const [topAndroid, setTopAndroid] = useState<any[]>([])
  const [topLoading, setTopLoading] = useState(false)
  const [issueModal, setIssueModal] = useState<{ open: boolean; item?: any; platform?: 'android'|'ios'; dateKey?: string }>(()=>({ open:false }))
  const [issueAnalysis, setIssueAnalysis] = useState<any | null>(null)
  const [issueLoading, setIssueLoading] = useState(false)
  const [issueError, setIssueError] = useState<string>('')
  const [dateRangeAndroid, setDateRangeAndroid] = useState<{start:string,end:string}|null>(null)
  const [dateRangeIOS, setDateRangeIOS] = useState<{start:string,end:string}|null>(null)
  const [autoEnabled, setAutoEnabled] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(false)
  const [scheduleDays, setScheduleDays] = useState<string[]>(['mon'])
  const [scheduleTime, setScheduleTime] = useState('09:00')
  // KST 날짜 라벨 헬퍼
  const toKstDate = (dateStr?: string) => {
    if (!dateStr) return '-'
    const kst = formatKST(`${dateStr}T00:00:00Z`)
    return kst.slice(0, 10)
  }


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
    fetchSettings()
  }, [fetchSettings])



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
      const period = selectedReport?.target_date 
        ? `${selectedReport.target_date} 주차`
        : `${selectedReport?.start_date} ~ ${selectedReport?.end_date}`
        
      let message = `📈 *주간 크래시 리포트 - ${period}*\n\n`
      
      // 데이터 구조 디버깅을 위한 로그
      console.log('Weekly Report Data Structure:', reportData)
      
      // 다양한 데이터 구조에 대응
      let summary, topIssues, newIssues, resolvedIssues, staleCandidates
      
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
        staleCandidates = reportData.staleCandidates || reportData.stale_candidates || []
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
        staleCandidates = data.staleCandidates || data.stale_candidates || []
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
        message += `🔥 *주요 이슈 (상위 ${Math.min(10, topIssues.length)}개)*\n`
        topIssues.slice(0, 10).forEach((issue: any, index: number) => {
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
        newIssues.slice(0, 5).forEach((issue: any) => {
          const title = issue.title || issue.culprit || issue.message || 'Unknown Error'
          message += `• ${title}\n`
        })
        message += '\n'
      }
      
      // 해결된 이슈 섹션
      if (resolvedIssues && resolvedIssues.length > 0) {
        message += `✅ *해결된 이슈 (${resolvedIssues.length}개)*\n`
        resolvedIssues.slice(0, 5).forEach((issue: any) => {
          const title = issue.title || issue.culprit || issue.message || 'Unknown Error'
          message += `• ${title}\n`
        })
        message += '\n'
      }
      
      // 정리 대상 이슈 섹션
      if (staleCandidates && staleCandidates.length > 0) {
        message += `🗑️ *정리 대상 이슈 (${staleCandidates.length}개)*\n`
        staleCandidates.slice(0, 3).forEach((issue: any) => {
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



  useEffect(() => {
    const loadTop = async () => {
      setTopLoading(true)
      try {
        const aRes = await fetch('/api/reports/weekly/top?platform=android').then(r=>r.json())
        setTopAndroid(aRes?.data?.top || [])
        if (aRes?.data?.dateRange) setDateRangeAndroid(aRes.data.dateRange)
      } catch {}
      setTopLoading(false)
    }
    loadTop()
  }, [])

  const openIssue = async (item:any, platform:'android'|'ios') => {
    // 팝업만 열고, 분석은 클릭 시 수행
    const dr = platform === 'android' ? dateRangeAndroid : dateRangeIOS
    const dateKey = dr ? `${dr.start}~${dr.end}` : ''
    setIssueModal({ open:true, item, platform, dateKey })
    setIssueAnalysis(null)
    setIssueError('')
    setIssueLoading(false)
    // 캐시가 있다면 미리 로딩
    try {
      if (item?.issueId && dateKey) {
        const res = await fetch(`/api/reports/issues/${encodeURIComponent(item.issueId)}/analysis?platform=${platform}&type=weekly&dateKey=${encodeURIComponent(dateKey)}`)
        const j = await res.json()
        setIssueAnalysis(j?.data?.analysis || null)
      }
    } catch { /* noop */ }
  }

  const runIssueAnalysis = async (force = true) => {
    if (!issueModal.item || !issueModal.platform) return
    setIssueLoading(true)
    setIssueAnalysis(null)
    setIssueError('')
    try {
      const dateKey = issueModal.dateKey || new Date().toISOString().slice(0,10)
      const res = await fetch(`/api/reports/issues/${encodeURIComponent(issueModal.item.issueId)}/analysis`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ platform: issueModal.platform, type:'weekly', dateKey, force })
      })
      const j = await res.json()
      if (!res.ok || !j?.success) throw new Error(j?.error || 'AI 분석 실패')
      setIssueAnalysis(j?.data?.analysis || null)
    } catch (e:any) {
      setIssueError(e?.message || 'AI 분석 중 오류가 발생했습니다')
    }
    setIssueLoading(false)
  }

  const renderAnalysis = (text?: string) => {
    if (!text) return <span className="muted">아직 분석되지 않았습니다.</span>
    const html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br/>')
    return <span dangerouslySetInnerHTML={{ __html: html }} />
  }

  return (
    <div className="container">
      <Group justify="space-between" align="flex-start" mb="sm">
        <div>
          <Title order={2}>🤖 Android 주간 리포트</Title>
          <Text c="dimmed" size="sm">Android 플랫폼의 Sentry 주간 크래시 리포트를 생성하고 관리합니다.</Text>
        </div>
      </Group>

      {/* Top 5 이슈 (플랫폼별) */}
      <Card withBorder radius="lg" p="lg" mt="md">
        <Title order={4} mb="sm">🏅 Android Top 5 이슈 (최근 리포트)</Title>
        {topLoading ? (
          <Text c="dimmed">불러오는 중…</Text>
        ) : (
          <Group align="stretch" wrap="wrap" gap={24}>
            {[{key:'android', label:'🤖 ANDROID', data: topAndroid}].map(col => (
              <Card key={col.key} withBorder radius="md" p="md" style={{ flex:1, minWidth:320 }}>
                <Text fw={700} mb={8}>{col.label}</Text>
                {col.data.length === 0 ? (
                  <Text c="dimmed">데이터가 없습니다.</Text>
                ) : (
                  <Stack gap={8}>
                    {col.data.map((it:any, idx:number)=>(
                      <Card key={it.issueId || idx} withBorder radius="md" p="sm">
                        <Group justify="space-between" align="center">
                          <div style={{ maxWidth:'70%' }}>
                            <Text fw={600} size="sm" mb={4}>{idx+1}. {it.title}</Text>
                            <Text c="dimmed" size="xs">📈 {it.events}건 {it.users!=null?`· 👥 ${it.users}명`:''}</Text>
                          </div>
                          <Group gap={8}>
                            {it.link && (
                              <Button component="a" href={it.link} target="_blank" variant="light" size="xs">Sentry</Button>
                            )}
                            <Button variant="light" size="xs" onClick={()=>openIssue(it, col.key as any)}>상세보기</Button>
                          </Group>
                        </Group>
                      </Card>
                    ))}
                  </Stack>
                )}
              </Card>
            ))}
          </Group>
        )}
      </Card>

      {/* 결과 보기 모달 */}
      {/* 이슈 상세 모달 */}
      <Modal opened={issueModal.open} onClose={() => setIssueModal({ open: false })} title="이슈 상세" size="lg" centered>
        {issueModal.item && (
          <Stack gap="sm">
            <Text fw={600}>{issueModal.item.title}</Text>
            <Text c="dimmed" size="sm">📈 {issueModal.item.events}건 {issueModal.item.users!=null?`· 👥 ${issueModal.item.users}명`:''}</Text>
            <div>
              <Text fw={600} size="sm">AI 분석 결과</Text>
              <div style={{ marginTop: 8 }}>
                {issueAnalysis?.summary ? (
                  <Text style={{ lineHeight: 1.6 }}>{renderAnalysis(issueAnalysis.summary) as any}</Text>
                ) : (
                  <Text c="dimmed" size="sm">아직 분석되지 않았습니다. 아래의 "AI 분석" 버튼을 눌러 분석을 실행하세요.</Text>
                )}
              </div>
            </div>
            <Group gap={8}>
              {issueModal.item.link && (
                <Button component="a" href={issueModal.item.link} target="_blank" variant="light">Sentry에서 열기</Button>
              )}
              <Button onClick={()=>runIssueAnalysis(!!issueAnalysis?.summary)} loading={issueLoading} color="green">
                {!!issueAnalysis?.summary ? 'AI 재분석' : 'AI 분석'}
              </Button>
            </Group>
            {issueError && (<Text c="red">⚠️ {issueError}</Text>)}
          </Stack>
        )}
      </Modal>
      
      <Modal opened={showModal && !!selectedReport} onClose={() => setShowModal(false)} title={`리포트 결과 - ${selectedReport?.target_date ? `${selectedReport?.target_date} 주차` : `${selectedReport?.start_date} ~ ${selectedReport?.end_date}`}`} size="lg" centered>
        {selectedReport && (
          <Stack gap="sm">
            <div>
              <Text><Text span fw={600}>상태:</Text> {getStatusText(selectedReport.status)}</Text>
              <Text><Text span fw={600}>실행 방식:</Text> {selectedReport.trigger_type === 'scheduled' ? '자동' : '수동'}</Text>
              <Text><Text span fw={600}>실행 시간:</Text> {formatExecutionTime(selectedReport.execution_time_ms)}</Text>
              <Text><Text span fw={600}>Slack 전송:</Text> {selectedReport.slack_sent ? '✅ 성공' : '❌ 실패'}</Text>
            </div>
            {selectedReport.error_message && (
              <div>
                <Text fw={700} c="red">오류 메시지:</Text>
                <Text size="sm" c="red">{selectedReport.error_message}</Text>
              </div>
            )}
            {selectedReport.execution_logs && selectedReport.execution_logs.length > 0 && (
              <div>
                <SectionToggle open={expandedSections.logs} onClick={() => toggleSection('logs')} label="실행 로그" />
                {expandedSections.logs && (
                  <pre style={{ marginTop: 8, padding: 12, borderRadius: 8, fontSize: 11, overflow: 'auto', maxHeight: 400, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'var(--mantine-color-dark-7)' }}>
                    {(selectedReport.execution_logs as string[]).join('\\n')}
                  </pre>
                )}
              </div>
            )}
            {selectedReport.result_data && (
              <div>
                <SectionToggle open={expandedSections.data} onClick={() => toggleSection('data')} label="리포트 데이터" />
                {expandedSections.data && (
                  <pre style={{ marginTop: 8, padding: 12, borderRadius: 8, fontSize: 12, overflow: 'auto', maxHeight: 300, background: 'var(--mantine-color-dark-7)' }}>
                    {JSON.stringify(selectedReport.result_data, null, 2)}
                  </pre>
                )}
              </div>
            )}
            {selectedReport.result_data && (
              <div>
                <SectionToggle open={expandedSections.slack} onClick={() => toggleSection('slack')} label="Slack 메시지 미리보기" />
                {expandedSections.slack && (
                  <Card withBorder radius="md" p="md" mt={8}>
                    {(() => {
                      const blocks = (selectedReport.result_data as any)?.slack_blocks
                      if (Array.isArray(blocks) && blocks.length > 0) {
                        return <SlackPreview blocks={blocks} />
                      }
                      return renderSlackMessage(selectedReport.result_data)
                    })()}
                  </Card>
                )}
              </div>
            )}
          </Stack>
        )}
      </Modal>
    </div>
  )
}
