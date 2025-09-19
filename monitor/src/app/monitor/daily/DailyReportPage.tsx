'use client'

import React, { useMemo, useState } from 'react'
import { ActionIcon, Button, Card, Group, Modal, Stack, Text, Title } from '@mantine/core'
import { IconChevronLeft, IconChevronRight, IconRefresh } from '@tabler/icons-react'
import StatsCards from '@/components/StatsCards'
import StatusBadge from '@/components/StatusBadge'
import SectionToggle from '@/components/SectionToggle'
import SlackPreview from '@/lib/SlackPreview'
import { formatExecutionTime, formatKST } from '@/lib/utils'
import { useReportHistory } from '@/lib/reports/useReportHistory'
import type { Platform } from '@/lib/types'
import type { DailyReportData, ReportExecution } from '@/lib/reports/types'

type DailyReportPayload = (DailyReportData & { slack_blocks?: unknown }) | undefined

type DayData = Exclude<DailyReportData[string], string>

type NormalizedIssue = {
  issueId: string
  title: string
  events: number
  users: number | null
  link?: string
}

interface DailyReportPageProps {
  platform: Platform
  title: string
  description: string
  cardTitle: string
}

const formatDateLabel = (date?: string) => {
  if (!date) return '-'
  return formatKST(`${date}T00:00:00Z`).split(' ')[0] ?? date
}

const toPercent = (value?: number | null) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '-'
  const percent = value <= 1 ? value * 100 : value
  return `${percent.toFixed(1)}%`
}

function normalizeTopIssues(items?: any[]): NormalizedIssue[] {
  if (!Array.isArray(items)) return []
  return items.map((issue, idx) => {
    const issueId = String(
      issue?.issue_id || issue?.issueId || issue?.['issue.id'] || issue?.issue || `issue-${idx}`,
    )
    return {
      issueId,
      title: issue?.title || issue?.culprit || issue?.message || '제목 없음',
      events: Number(issue?.event_count ?? issue?.events ?? issue?.['count()'] ?? 0),
      users: issue?.users ?? issue?.user_count ?? null,
      link: issue?.link || issue?.permalink || undefined,
    }
  })
}

export default function DailyReportPage({ platform, title, description, cardTitle }: DailyReportPageProps) {
  const {
    reports,
    selectedReport,
    selectedIndex,
    isLoading,
    error,
    hasPrev,
    hasNext,
    goPrev,
    goNext,
    refresh,
  } = useReportHistory({ reportType: 'daily', platform, limit: 20 })

  const [detailsReport, setDetailsReport] = useState<ReportExecution | null>(null)
  const [expandedSections, setExpandedSections] = useState({ logs: false, data: false, slack: false })
  const [issueModal, setIssueModal] = useState<{ open: boolean; item?: NormalizedIssue; dateKey?: string }>({ open: false })
  const [issueAnalysis, setIssueAnalysis] = useState<any | null>(null)
  const [issueLoading, setIssueLoading] = useState(false)
  const [issueError, setIssueError] = useState('')

  const payload = useMemo<DailyReportPayload>(() => {
    if (!selectedReport?.result_data) return undefined
    return selectedReport.result_data as DailyReportPayload
  }, [selectedReport])

  const dayData = useMemo<DayData | null>(() => {
    if (!payload || !selectedReport?.target_date) return null
    const data = payload[selectedReport.target_date]
    if (!data || typeof data === 'string') {
      return null
    }
    return data
  }, [payload, selectedReport])

  const topIssues = useMemo(() => normalizeTopIssues((dayData as any)?.top_5_issues), [dayData])

  const summaryItems = useMemo(() => {
    if (!dayData) return []
    return [
      { label: '총 이벤트', value: dayData.crash_events ?? '-' },
      { label: '고유 이슈', value: dayData.unique_issues ?? dayData.issues_count ?? '-' },
      { label: '영향 사용자', value: dayData.impacted_users ?? '-' },
      { label: 'Crash Free(세션)', value: toPercent(dayData.crash_free_sessions_pct) },
      { label: 'Crash Free(사용자)', value: toPercent(dayData.crash_free_users_pct) },
    ]
  }, [dayData])

  const windowLabel = useMemo(() => {
    if (!dayData?.window_utc?.start || !dayData?.window_utc?.end) return null
    return `${formatKST(dayData.window_utc.start)} ~ ${formatKST(dayData.window_utc.end)}`
  }, [dayData])

  const dateLabel = formatDateLabel(selectedReport?.target_date)

  const handleOpenDetails = () => {
    if (!selectedReport) return
    setDetailsReport(selectedReport)
    setExpandedSections({ logs: false, data: false, slack: false })
  }

  const toggleSection = (section: 'logs' | 'data' | 'slack') => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }))
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

  const renderSlackMessage = (reportData: any) => {
    if (!reportData) return '리포트 데이터가 없습니다.'

    try {
      let message = `📊 *일간 크래시 리포트 - ${selectedReport?.target_date ?? ''}*\n\n`

      let summary
      let top
      let newIssues
      let resolved

      if (reportData.summary || reportData.topIssues || reportData.total_events) {
        summary = reportData.summary || {
          totalEvents: reportData.total_events,
          totalIssues: reportData.total_issues,
          totalUsers: reportData.total_users,
          newIssues: reportData.new_issues_count,
          resolvedIssues: reportData.resolved_issues_count,
        }
        top = reportData.topIssues || reportData.top_issues || []
        newIssues = reportData.newIssues || reportData.new_issues || []
        resolved = reportData.resolvedIssues || reportData.resolved_issues || []
      } else if (reportData.data) {
        const data = reportData.data
        summary = data.summary || {
          totalEvents: data.total_events,
          totalIssues: data.total_issues,
          totalUsers: data.total_users,
          newIssues: data.new_issues_count,
          resolvedIssues: data.resolved_issues_count,
        }
        top = data.topIssues || data.top_issues || []
        newIssues = data.newIssues || data.new_issues || []
        resolved = data.resolvedIssues || data.resolved_issues || []
      }

      if (summary) {
        message += '🔢 *요약*\n'
        message += `• 총 이벤트: ${summary.totalEvents || summary.total_events || 0}건\n`
        message += `• 총 이슈: ${summary.totalIssues || summary.total_issues || 0}개\n`
        message += `• 영향 사용자: ${summary.totalUsers || summary.total_users || 0}명\n`
        message += `• 신규 이슈: ${summary.newIssues || summary.new_issues_count || 0}개\n`
        message += `• 해결된 이슈: ${summary.resolvedIssues || summary.resolved_issues_count || 0}개\n\n`
      }

      if (Array.isArray(top) && top.length > 0) {
        message += `🔥 *주요 이슈 (상위 ${Math.min(5, top.length)}개)*\n`
        top.slice(0, 5).forEach((issue: any, index: number) => {
          const title = issue.title || issue.culprit || issue.message || 'Unknown Error'
          const events = issue.events || issue.event_count || 0
          const users = issue.users || issue.user_count || 0
          message += `${index + 1}. ${title}\n`
          message += `   📈 ${events}건 | 👥 ${users}명\n`
        })
        message += '\n'
      }

      if (Array.isArray(newIssues) && newIssues.length > 0) {
        message += `🆕 *신규 이슈 (${newIssues.length}개)*\n`
        newIssues.slice(0, 3).forEach((issue: any) => {
          const title = issue.title || issue.culprit || issue.message || 'Unknown Error'
          message += `• ${title}\n`
        })
        message += '\n'
      }

      if (Array.isArray(resolved) && resolved.length > 0) {
        message += `✅ *해결된 이슈 (${resolved.length}개)*\n`
        resolved.slice(0, 3).forEach((issue: any) => {
          const title = issue.title || issue.culprit || issue.message || 'Unknown Error'
          message += `• ${title}\n`
        })
        message += '\n'
      }

      return message
    } catch (err) {
      return `슬랙 메시지 미리보기 생성 오류: ${err}\n\n원본 데이터:\n${JSON.stringify(reportData, null, 2)}`
    }
  }

  const openIssue = async (issue: NormalizedIssue) => {
    const dateKey = selectedReport?.target_date
    if (!dateKey) return

    setIssueModal({ open: true, item: issue, dateKey })
    setIssueAnalysis(null)
    setIssueError('')
    setIssueLoading(false)

    try {
      const res = await fetch(
        `/api/reports/issues/${encodeURIComponent(issue.issueId)}/analysis?platform=${platform}&type=daily&dateKey=${dateKey}`,
      )
      const json = await res.json()
      if (json?.success) {
        setIssueAnalysis(json.data?.analysis || null)
      } else if (json?.error) {
        setIssueError(json.error)
      }
    } catch (err) {
      setIssueError(err instanceof Error ? err.message : '이슈 분석을 불러오지 못했습니다.')
    }
  }

  const runIssueAnalysis = async (force = true) => {
    if (!issueModal.item || !issueModal.dateKey) return
    setIssueLoading(true)
    setIssueAnalysis(null)
    setIssueError('')

    try {
      const res = await fetch(`/api/reports/issues/${encodeURIComponent(issueModal.item.issueId)}/analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, type: 'daily', dateKey: issueModal.dateKey, force }),
      })
      const json = await res.json()
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || 'AI 분석 실패')
      }
      setIssueAnalysis(json.data?.analysis || null)
    } catch (err) {
      setIssueError(err instanceof Error ? err.message : 'AI 분석 중 오류가 발생했습니다')
    } finally {
      setIssueLoading(false)
    }
  }

  const handleCloseIssueModal = () => {
    setIssueModal({ open: false })
    setIssueError('')
    setIssueAnalysis(null)
  }

  return (
    <div className="container">
      <Group justify="space-between" align="flex-start" mb="sm">
        <div>
          <Title order={2}>{title}</Title>
          <Text c="dimmed" size="sm">{description}</Text>
        </div>
        <Button
          variant="default"
          size="xs"
          leftSection={<IconRefresh size={14} />}
          onClick={refresh}
          loading={isLoading}
        >
          새로고침
        </Button>
      </Group>

      <Card withBorder radius="lg" p="lg" mt="md">
        <Group justify="space-between" align="center" mb="md" wrap="wrap">
          <div>
            <Title order={4}>{cardTitle}</Title>
            <Text c="dimmed" size="sm">
              {selectedReport ? `${dateLabel} 기준 데이터 (총 ${reports.length}건 중 ${selectedIndex + 1}번째)` : '리포트가 없습니다.'}
            </Text>
            {selectedReport && (
              <Group gap={8} mt={4} wrap="wrap">
                <StatusBadge kind="report" status={selectedReport.status} />
                <Text size="xs" c="dimmed">
                  {selectedReport.trigger_type === 'scheduled' ? '자동 실행' : '수동 실행'} · {formatExecutionTime(selectedReport.execution_time_ms)}
                </Text>
              </Group>
            )}
          </div>
          <Group gap="xs" wrap="nowrap">
            <Button variant="light" size="xs" onClick={handleOpenDetails} disabled={!selectedReport}>
              리포트 상세
            </Button>
            <ActionIcon
              variant="default"
              aria-label="이전 리포트"
              onClick={goPrev}
              disabled={!hasPrev || isLoading}
            >
              <IconChevronLeft size={16} />
            </ActionIcon>
            <ActionIcon
              variant="default"
              aria-label="다음 리포트"
              onClick={goNext}
              disabled={!hasNext || isLoading}
            >
              <IconChevronRight size={16} />
            </ActionIcon>
          </Group>
        </Group>

        {error && (
          <Text c="red" size="sm" mb="sm">
            ⚠️ {error}
          </Text>
        )}

        {isLoading && !selectedReport ? (
          <Text c="dimmed">불러오는 중…</Text>
        ) : !selectedReport ? (
          <Text c="dimmed">표시할 리포트가 없습니다.</Text>
        ) : (
          <Stack gap="md">
            {selectedReport.status === 'error' && (
              <Text c="red" size="sm">
                ⚠️ 이 실행은 실패했습니다. 상세 화면에서 오류 메시지를 확인하세요.
              </Text>
            )}
            {summaryItems.length > 0 && <StatsCards items={summaryItems} />}

            {windowLabel && (
              <Text size="xs" c="dimmed">
                집계 구간 (KST 기준): {windowLabel}
              </Text>
            )}

            <Stack gap={8}>
              {topIssues.length === 0 ? (
                <Text c="dimmed">Top 5 이슈 데이터가 없습니다.</Text>
              ) : (
                topIssues.map((issue, idx) => (
                  <Card key={issue.issueId || idx} withBorder radius="md" p="sm">
                    <Group justify="space-between" align="center" wrap="wrap">
                      <div style={{ maxWidth: '70%' }}>
                        <Text fw={600} size="sm" mb={4}>
                          {idx + 1}. {issue.title}
                        </Text>
                        <Text c="dimmed" size="xs">
                          📈 {issue.events}건{issue.users != null ? ` · 👥 ${issue.users}명` : ''}
                        </Text>
                      </div>
                      <Group gap={8}>
                        {issue.link && (
                          <Button component="a" href={issue.link} target="_blank" variant="light" size="xs">
                            Sentry
                          </Button>
                        )}
                        <Button variant="light" size="xs" onClick={() => openIssue(issue)}>
                          상세보기
                        </Button>
                      </Group>
                    </Group>
                  </Card>
                ))
              )}
            </Stack>
          </Stack>
        )}
      </Card>

      <Modal opened={issueModal.open} onClose={handleCloseIssueModal} title="이슈 상세" size="lg" centered>
        {issueModal.item && (
          <Stack gap="sm">
            <Text fw={600}>{issueModal.item.title}</Text>
            <Text c="dimmed" size="sm">
              📈 {issueModal.item.events}건{issueModal.item.users != null ? ` · 👥 ${issueModal.item.users}명` : ''}
            </Text>
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
                <Button component="a" href={issueModal.item.link} target="_blank" variant="light">
                  Sentry에서 열기
                </Button>
              )}
              <Button onClick={() => runIssueAnalysis(!!issueAnalysis?.summary)} loading={issueLoading} color="green">
                {issueAnalysis?.summary ? 'AI 재분석' : 'AI 분석'}
              </Button>
            </Group>
            {issueError && (
              <Text c="red">⚠️ {issueError}</Text>
            )}
          </Stack>
        )}
      </Modal>

      <Modal
        opened={!!detailsReport}
        onClose={() => setDetailsReport(null)}
        title={`리포트 결과 - ${detailsReport?.target_date ?? ''}`}
        size="lg"
        centered
      >
        {detailsReport && (
          <Stack gap="sm">
            <div>
              <Text>
                <Text span fw={600}>
                  상태:
                </Text>{' '}
                {detailsReport.status === 'success' ? '✅ 성공' : detailsReport.status === 'error' ? '❌ 실패' : '🔄 실행중'}
              </Text>
              <Text>
                <Text span fw={600}>
                  실행 방식:
                </Text>{' '}
                {detailsReport.trigger_type === 'scheduled' ? '자동' : '수동'}
              </Text>
              <Text>
                <Text span fw={600}>
                  실행 시간:
                </Text>{' '}
                {formatExecutionTime(detailsReport.execution_time_ms)}
              </Text>
              <Text>
                <Text span fw={600}>
                  Slack 전송:
                </Text>{' '}
                {detailsReport.slack_sent ? '✅ 성공' : '❌ 실패'}
              </Text>
            </div>

            {detailsReport.error_message && (
              <div>
                <Text fw={700} c="red">
                  오류 메시지:
                </Text>
                <Text size="sm" c="red">
                  {detailsReport.error_message}
                </Text>
              </div>
            )}

            {Array.isArray(detailsReport.execution_logs) && detailsReport.execution_logs.length > 0 && (
              <div>
                <SectionToggle open={expandedSections.logs} onClick={() => toggleSection('logs')} label="실행 로그" />
                {expandedSections.logs && (
                  <pre
                    style={{
                      marginTop: 8,
                      padding: 12,
                      borderRadius: 8,
                      fontSize: 11,
                      overflow: 'auto',
                      maxHeight: 400,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      background: 'var(--mantine-color-dark-7)',
                    }}
                  >
                    {(detailsReport.execution_logs as string[]).join('\n')}
                  </pre>
                )}
              </div>
            )}

            {detailsReport.result_data && (
              <div>
                <SectionToggle open={expandedSections.data} onClick={() => toggleSection('data')} label="리포트 데이터" />
                {expandedSections.data && (
                  <pre
                    style={{
                      marginTop: 8,
                      padding: 12,
                      borderRadius: 8,
                      fontSize: 12,
                      overflow: 'auto',
                      maxHeight: 300,
                      background: 'var(--mantine-color-dark-7)',
                    }}
                  >
                    {JSON.stringify(detailsReport.result_data, null, 2)}
                  </pre>
                )}
              </div>
            )}

            {detailsReport.result_data && (
              <div>
                <SectionToggle open={expandedSections.slack} onClick={() => toggleSection('slack')} label="Slack 메시지 미리보기" />
                {expandedSections.slack && (
                  <Card withBorder radius="md" p="md" mt={8}>
                    {(() => {
                      const blocks = (detailsReport.result_data as any)?.slack_blocks
                      if (Array.isArray(blocks) && blocks.length > 0) {
                        return <SlackPreview blocks={blocks} />
                      }
                      return renderSlackMessage(detailsReport.result_data)
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
