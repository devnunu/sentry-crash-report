'use client'

import React, { useState, useEffect, useCallback } from 'react'
import SlackPreview from '@/lib/SlackPreview'
import { Button, Card, Group, Modal, Select, Stack, Table, Text, Title, useMantineTheme } from '@mantine/core'
import TableWrapper from '@/components/TableWrapper'
import StatusBadge from '@/components/StatusBadge'
import SectionToggle from '@/components/SectionToggle'
import { notifications } from '@mantine/notifications'
import { useMediaQuery } from '@mantine/hooks'
import StatsCards from '@/components/StatsCards'
import { formatKST, formatExecutionTime } from '@/lib/utils'
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

export default function DailyAndroidReportPage() {
  // 상태 관리
  const [reports, setReports] = useState<ReportExecution[]>([])
  const [, setSettings] = useState<ReportSettings | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  
  
  
  // 결과 모달 상태
  const [selectedReport, setSelectedReport] = useState<ReportExecution | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [expandedSections, setExpandedSections] = useState({
    logs: false,
    data: false,
    slack: false
  })
  // Cron 상태(디버그)
  // 플랫폼 필터 (히스토리)
  const [historyPlatform] = useState<'all' | 'android' | 'ios'>('android')
  // Top5 상태
  const [topAndroid, setTopAndroid] = useState<any[]>([])
  const [topDateKeyAndroid, setTopDateKeyAndroid] = useState<string>('')
  const [topLoading, setTopLoading] = useState(false)
  const [issueModal, setIssueModal] = useState<{ open: boolean; item?: any; platform?: 'android'|'ios'; dateKey?: string }>(()=>({ open: false }))
  const [issueAnalysis, setIssueAnalysis] = useState<any | null>(null)
  const [issueLoading, setIssueLoading] = useState(false)
  const [issueError, setIssueError] = useState<string>('')
  const theme = useMantineTheme()
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`)
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


  // 컴포넌트 마운트 시 데이터 로드
  useEffect(() => {
    fetchReports()
    // 최신 Top5 로드
    const loadTop = async () => {
      setTopLoading(true)
      try {
        const aRes = await fetch('/api/reports/daily/top?platform=android').then(r=>r.json())
        setTopAndroid(aRes?.data?.top || [])
        setTopDateKeyAndroid(aRes?.data?.dateKey || '')
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
  }, [fetchReports])

  const openIssue = async (item: any, platform: 'android'|'ios') => {
    // 팝업만 열고, 분석은 사용자가 버튼을 눌렀을 때만 수행
    const dateKey = platform === 'android' ? topDateKeyAndroid : topDateKeyIOS
    setIssueModal({ open: true, item, platform, dateKey })
    setIssueAnalysis(null)
    setIssueError('')
    setIssueLoading(false)
    // 캐시된 분석이 있으면 미리 표시
    try {
      if (item?.issueId && dateKey) {
        const res = await fetch(`/api/reports/issues/${encodeURIComponent(item.issueId)}/analysis?platform=${platform}&type=daily&dateKey=${dateKey}`)
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
      const postRes = await fetch(`/api/reports/issues/${encodeURIComponent(issueModal.item.issueId)}/analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: issueModal.platform, type: 'daily', dateKey, force })
      })
      const postJson = await postRes.json()
      if (!postRes.ok || !postJson?.success) {
        throw new Error(postJson?.error || 'AI 분석 실패')
      }
      setIssueAnalysis(postJson?.data?.analysis || null)
    } catch (e:any) {
      setIssueError(e?.message || 'AI 분석 중 오류가 발생했습니다')
    }
    setIssueLoading(false)
  }

  // 간단한 마크다운 렌더링(굵게/줄바꿈)
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


  // 어제 날짜 기본값

  return (
    <div className="container">
      <Group justify="space-between" align="flex-start" mb="sm">
        <div>
          <Title order={2}>🤖 Android 일간 리포트</Title>
          <Text c="dimmed" size="sm">
            Android 플랫폼의 Sentry 일간 크래시 리포트를 생성하고 관리합니다.
          </Text>
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
              <Card key={col.key} withBorder radius="md" p="md" style={{ flex: 1, minWidth: 320 }}>
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
      <StatsCards
        items={[
          { label: '리포트(최근)', value: reports.length },
          { label: '성공', value: reports.filter(r => r.status === 'success').length, color: 'green' },
          { label: '실패', value: reports.filter(r => r.status === 'error').length, color: 'red' },
          { label: '실행중', value: reports.filter(r => r.status === 'running').length, color: 'yellow' },
        ]}
      />


      {/* 히스토리 섹션 */}
      <Card withBorder radius="lg" p="lg" mt="md">
        <Group justify="space-between" align="center">
          <Title order={4}>📋 실행 히스토리</Title>
          <Group gap={12} align="center">
            <Button onClick={fetchReports} loading={loading} variant="light">새로고침</Button>
          </Group>
        </Group>

        {error && (
          <Text c="red">⚠️ {error}</Text>
        )}

        {reports.length === 0 ? (
          <Text c="dimmed" ta="center" py={40}>{loading ? '로딩 중...' : '리포트 히스토리가 없습니다.'}</Text>
        ) : (
          <>
            {!isMobile && (
            <TableWrapper>
                <Table highlightOnHover withColumnBorders verticalSpacing="xs" stickyHeader stickyHeaderOffset={0}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>분석 날짜</Table.Th>
                      <Table.Th>플랫폼</Table.Th>
                      <Table.Th>상태</Table.Th>
                      <Table.Th>실행 방식</Table.Th>
                      <Table.Th>실행 시간</Table.Th>
                      <Table.Th>Slack 전송</Table.Th>
                      <Table.Th>생성 일시</Table.Th>
                      <Table.Th style={{ textAlign: 'right' }}>액션</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {reports.map((report) => {
                      return (
                        <Table.Tr key={report.id}>
                          <Table.Td>{toKstDate(report.target_date)}</Table.Td>
                          <Table.Td>{report.platform ? report.platform.toUpperCase() : '-'}</Table.Td>
                          <Table.Td><StatusBadge kind="report" status={report.status} /></Table.Td>
                          <Table.Td>{report.trigger_type === 'scheduled' ? '자동' : '수동'}</Table.Td>
                          <Table.Td>{formatExecutionTime(report.execution_time_ms)}</Table.Td>
                          <Table.Td>{report.slack_sent ? '✅' : '❌'}</Table.Td>
                          <Table.Td>{formatKST(report.created_at)}</Table.Td>
                          <Table.Td style={{ textAlign: 'right' }}>
                            <Button onClick={() => handleViewReport(report)} variant="light" size="xs">결과 보기</Button>
                          </Table.Td>
                        </Table.Tr>
                      )
                    })}
                  </Table.Tbody>
                </Table>
            </TableWrapper>
            )}

          {/* 모바일 카드 */}
          {isMobile && (
          <div className="mobile-cards" style={{ marginTop: 16 }}>
            {reports.map((report) => (
              <Card key={report.id} withBorder radius="md" p="md" style={{ marginBottom: 12 }}>
                <Group justify="space-between" align="center" mb={8}>
                  <StatusBadge kind="report" status={report.status} />
                  <Button size="xs" variant="light" onClick={() => handleViewReport(report)}>결과 보기</Button>
                </Group>
                <Stack gap={6}>
                  <Text size="xs" c="dimmed">분석 날짜</Text>
                  <Text size="sm">{toKstDate(report.target_date)}</Text>
                  <Text size="xs" c="dimmed">플랫폼</Text>
                  <Text size="sm">{report.platform ? report.platform.toUpperCase() : '-'}</Text>
                  <Text size="xs" c="dimmed">실행 방식</Text>
                  <Text size="sm">{report.trigger_type === 'scheduled' ? '자동' : '수동'}</Text>
                  <Text size="xs" c="dimmed">실행 시간</Text>
                  <Text size="sm">{formatExecutionTime(report.execution_time_ms)}</Text>
                  <Text size="xs" c="dimmed">Slack 전송</Text>
                  <Text size="sm">{report.slack_sent ? '✅' : '❌'}</Text>
                  <Text size="xs" c="dimmed">생성 일시</Text>
                  <Text size="sm">{formatKST(report.created_at)}</Text>
                </Stack>
              </Card>
            ))}
          </div>
          )}
          </>
        )}
      </Card>

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
                  <Text c="dimmed" size="sm">아직 분석되지 않았습니다. 아래의 &quot;AI 분석&quot; 버튼을 눌러 분석을 실행하세요.</Text>
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
            {issueError && (
              <Text c="red">⚠️ {issueError}</Text>
            )}
          </Stack>
        )}
      </Modal>
      <Modal opened={showModal && !!selectedReport} onClose={() => setShowModal(false)} title={`리포트 결과 - ${selectedReport?.target_date ?? ''}`} size="lg" centered>
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

            {Array.isArray(selectedReport.execution_logs) && selectedReport.execution_logs.length > 0 && (
              <div>
                <SectionToggle open={expandedSections.logs} onClick={() => toggleSection('logs')} label="실행 로그" />
                {expandedSections.logs && (
                  <pre style={{ marginTop: 8, padding: 12, borderRadius: 8, fontSize: 11, overflow: 'auto', maxHeight: 400, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'var(--mantine-color-dark-7)' }}>
                    {(selectedReport.execution_logs as string[]).join('\n')}
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
