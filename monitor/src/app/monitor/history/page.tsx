'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import SlackPreview from '@/lib/SlackPreview'
import { Badge, Button, Card, Group, Modal, Pagination, Select, Stack, Table, Text, Title, useMantineTheme } from '@mantine/core'
import TableWrapper from '@/components/TableWrapper'
import StatusBadge from '@/components/StatusBadge'
import SectionToggle from '@/components/SectionToggle'
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

export default function ReportHistoryPage() {
  const router = useRouter()
  
  // 상태 관리
  const [allReports, setAllReports] = useState<ReportExecution[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  
  // 페이지네이션 상태
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 10
  
  // 결과 모달 상태
  const [selectedReport, setSelectedReport] = useState<ReportExecution | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [expandedSections, setExpandedSections] = useState({
    logs: false,
    data: false,
    slack: false
  })
  
  // 필터 상태
  const [reportType, setReportType] = useState<'all' | 'daily' | 'weekly'>('all')
  const [historyPlatform, setHistoryPlatform] = useState<'all' | 'android' | 'ios'>('all')
  
  const theme = useMantineTheme()
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`)
  
  // 날짜 표시를 KST 기준으로 변환 (YYYY-MM-DD)
  const toKstDate = (dateStr?: string) => {
    if (!dateStr) return '-'
    // start_date/target_date는 'YYYY-MM-DD' 형태이므로 자정 UTC를 붙여 KST로 보정
    const kst = formatKST(`${dateStr}T00:00:00Z`)
    return kst.slice(0, 10)
  }

  // 실행 방식 Badge 생성
  const getTriggerBadge = (triggerType: string) => {
    const isScheduled = triggerType === 'scheduled'
    const label = isScheduled ? '자동' : '수동'
    const color = isScheduled ? 'blue' : 'gray'
    
    return (
      <Badge color={color} size="sm" variant="filled" radius="sm">
        {label}
      </Badge>
    )
  }

  // 히스토리 조회
  const fetchReports = useCallback(async () => {
    setLoading(true)
    setError('')
    
    try {
      let allReports: ReportExecution[] = []
      
      // 플랫폼 필터 구성
      const platformQuery = historyPlatform === 'all' ? '' : `&platform=${historyPlatform}`
      
      // 리포트 타입별로 API 호출 (모든 데이터 가져오기)
      if (reportType === 'all' || reportType === 'daily') {
        try {
          const dailyResponse = await fetch(`/api/reports/daily/history?limit=100${platformQuery}`)
          const dailyResult: ApiResponse<{ reports: ReportExecution[] }> = await dailyResponse.json()
          if (dailyResult.success && dailyResult.data) {
            // 일간 리포트에 타입 정보 추가
            const dailyReports = dailyResult.data.reports.map(report => ({
              ...report,
              report_type: 'daily' as const
            }))
            allReports = allReports.concat(dailyReports)
          }
        } catch (err) {
          console.warn('일간 리포트 히스토리 조회 실패:', err)
        }
      }
      
      if (reportType === 'all' || reportType === 'weekly') {
        try {
          const weeklyResponse = await fetch(`/api/reports/weekly/history?limit=100${platformQuery}`)
          const weeklyResult: ApiResponse<{ reports: ReportExecution[] }> = await weeklyResponse.json()
          if (weeklyResult.success && weeklyResult.data) {
            // 주간 리포트에 타입 정보 추가
            const weeklyReports = weeklyResult.data.reports.map(report => ({
              ...report,
              report_type: 'weekly' as const
            }))
            allReports = allReports.concat(weeklyReports)
          }
        } catch (err) {
          console.warn('주간 리포트 히스토리 조회 실패:', err)
        }
      }
      
      // 생성 일시 기준으로 정렬 (최신순)
      allReports.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      
      setAllReports(allReports)
      
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류')
    } finally {
      setLoading(false)
    }
  }, [reportType, historyPlatform])

  // 컴포넌트 마운트 시 데이터 로드
  useEffect(() => {
    fetchReports()
  }, [fetchReports])

  // 필터 변경 시 첫 페이지로 이동
  useEffect(() => {
    setCurrentPage(1)
  }, [reportType, historyPlatform])

  // 페이지 변경 핸들러
  const handlePageChange = (page: number) => {
    setCurrentPage(page)
  }

  // 현재 페이지에 표시할 리포트 계산
  const paginatedReports = allReports.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  )
  
  // 페이지네이션 정보 계산
  const totalPages = Math.ceil(allReports.length / pageSize)
  const totalCount = allReports.length

  // 결과 보기 - 적절한 리포트 페이지로 이동
  const handleViewReport = (report: ReportExecution) => {
    const reportTypeFromData = (report as any).report_type
    const reportType = reportTypeFromData || 'daily' // 기본값은 daily
    const platform = report.platform || 'android' // 기본값은 android
    const targetDate = report.target_date
    
    // 쿼리 파라미터로 날짜 전달
    const searchParams = new URLSearchParams()
    if (targetDate) {
      searchParams.set('date', targetDate)
    }
    
    const queryString = searchParams.toString()
    const queryPath = queryString ? `?${queryString}` : ''
    
    if (reportType === 'daily') {
      // 일간 리포트 페이지로 이동
      router.push(`/monitor/daily/${platform}${queryPath}`)
    } else if (reportType === 'weekly') {
      // 주간 리포트 페이지로 이동
      router.push(`/monitor/weekly/${platform}${queryPath}`)
    } else {
      // 일간 리포트를 기본값으로
      router.push(`/monitor/daily/${platform}${queryPath}`)
    }
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
      const isWeekly = selectedReport?.target_date?.includes('W') || selectedReport?.start_date
      const period = isWeekly 
        ? (selectedReport?.target_date 
          ? `${selectedReport.target_date} 주차`
          : `${selectedReport?.start_date} ~ ${selectedReport?.end_date}`)
        : selectedReport?.target_date
        
      let message = `${isWeekly ? '📈' : '📊'} *${isWeekly ? '주간' : '일간'} 크래시 리포트 - ${period}*\n\n`
      
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

  return (
    <div className="container">
      <Group justify="space-between" align="flex-start" mb="sm">
        <div>
          <Title order={2}>📋 리포트 실행 내역</Title>
          <Text c="dimmed" size="sm">
            일간 및 주간 리포트의 실행 내역을 조회하고 관리합니다.
          </Text>
        </div>
      </Group>

      {/* 통계 요약 */}
      <StatsCards
        items={[
          { label: '총 실행', value: totalCount },
          { label: '성공', value: allReports.filter(r => r.status === 'success').length, color: 'green' },
          { label: '실패', value: allReports.filter(r => r.status === 'error').length, color: 'red' },
          { label: '실행중', value: allReports.filter(r => r.status === 'running').length, color: 'yellow' },
        ]}
      />

      {/* 실행 히스토리 */}
      <Card withBorder radius="lg" p="lg" mt="md">
        <Group justify="space-between" align="center" mb="md">
          <Title order={4}>📋 실행 내역</Title>
          <Group gap={12} align="center">
            <Select
              placeholder="리포트 타입"
              data={[
                { value: 'all', label: '전체' }, 
                { value: 'daily', label: '일간 리포트' }, 
                { value: 'weekly', label: '주간 리포트' }
              ]}
              value={reportType}
              onChange={(val) => setReportType((val as any) ?? 'all')}
              allowDeselect={false}
              w={160}
            />
            <Select
              placeholder="플랫폼"
              data={[
                { value: 'all', label: '전체' }, 
                { value: 'android', label: 'Android' }, 
                { value: 'ios', label: 'iOS' }
              ]}
              value={historyPlatform}
              onChange={(val) => setHistoryPlatform((val as any) ?? 'all')}
              allowDeselect={false}
              w={160}
            />
            <Button onClick={fetchReports} loading={loading} variant="light">새로고침</Button>
          </Group>
        </Group>

        {error && (<Text c="red">⚠️ {error}</Text>)}

        {allReports.length === 0 && !loading && !error && (
          <Text c="dimmed" ta="center" py="xl">실행 내역이 없습니다.</Text>
        )}

        {allReports.length > 0 && (
          <>
            {/* 데스크톱 테이블 */}
            {!isMobile && (
            <TableWrapper>
                <Table highlightOnHover withColumnBorders verticalSpacing="xs" stickyHeader stickyHeaderOffset={0}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>리포트 타입</Table.Th>
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
                    {paginatedReports.map((report) => {
                      const reportTypeText = (report as any).report_type === 'daily' ? '일간' : '주간'
                      return (
                        <Table.Tr key={report.id}>
                          <Table.Td>{reportTypeText}</Table.Td>
                          <Table.Td>{toKstDate(report.target_date)}</Table.Td>
                          <Table.Td>{report.platform ? report.platform.toUpperCase() : '-'}</Table.Td>
                          <Table.Td><StatusBadge kind="report" status={report.status} /></Table.Td>
                          <Table.Td>{getTriggerBadge(report.trigger_type)}</Table.Td>
                          <Table.Td>{formatExecutionTime(report.execution_time_ms)}</Table.Td>
                          <Table.Td>{report.slack_sent ? '✅' : '❌'}</Table.Td>
                          <Table.Td>{formatKST(report.created_at)}</Table.Td>
                          <Table.Td style={{ textAlign: 'right' }}>
                            <Button size="xs" variant="light" onClick={() => handleViewReport(report)}>결과 보기</Button>
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
            {paginatedReports.map((report) => {
              const reportTypeText = (report as any).report_type === 'daily' ? '일간' : '주간'
              return (
                <Card key={report.id} withBorder radius="md" p="md" style={{ marginBottom: 12 }}>
                  <Group justify="space-between" align="center" mb={8}>
                    <StatusBadge kind="report" status={report.status} />
                    <Button size="xs" variant="light" onClick={() => handleViewReport(report)}>결과 보기</Button>
                  </Group>
                  <Stack gap={6}>
                    <Text size="xs" c="dimmed">리포트 타입</Text>
                    <Text size="sm">{reportTypeText}</Text>
                    <Text size="xs" c="dimmed">분석 날짜</Text>
                    <Text size="sm">{toKstDate(report.target_date)}</Text>
                    <Text size="xs" c="dimmed">플랫폼</Text>
                    <Text size="sm">{report.platform ? report.platform.toUpperCase() : '-'}</Text>
                    <Text size="xs" c="dimmed">실행 방식</Text>
                    <div>{getTriggerBadge(report.trigger_type)}</div>
                    <Text size="xs" c="dimmed">실행 시간</Text>
                    <Text size="sm">{formatExecutionTime(report.execution_time_ms)}</Text>
                    <Text size="xs" c="dimmed">Slack 전송</Text>
                    <Text size="sm">{report.slack_sent ? '✅ 성공' : '❌ 실패'}</Text>
                    <Text size="xs" c="dimmed">생성 일시</Text>
                    <Text size="sm">{formatKST(report.created_at)}</Text>
                  </Stack>
                </Card>
              )
            })}
          </div>
          )}
          </>
        )}

        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <Group justify="center" mt="lg">
            <Pagination
              value={currentPage}
              onChange={handlePageChange}
              total={totalPages}
              size="sm"
              withEdges
            />
            <Text size="sm" c="dimmed">
              총 {totalCount}개 중 {((currentPage - 1) * pageSize) + 1}-{Math.min(currentPage * pageSize, totalCount)}개 표시
            </Text>
          </Group>
        )}
      </Card>

      {/* 리포트 결과 모달 */}
      <Modal opened={showModal && !!selectedReport} onClose={() => setShowModal(false)} title={`리포트 결과 - ${selectedReport?.target_date ?? ''}`} size="lg" centered>
        {selectedReport && (
          <Stack gap="sm">
            <div>
              <Text><Text span fw={600}>상태:</Text> {selectedReport.status === 'success' ? '✅ 성공' : selectedReport.status === 'error' ? '❌ 실패' : selectedReport.status === 'running' ? '🔄 실행중' : selectedReport.status}</Text>
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