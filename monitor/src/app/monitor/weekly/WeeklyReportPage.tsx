'use client'

import React, { useMemo, useState } from 'react'
import { ActionIcon, Badge, Button, Card, Group, Modal, Stack, Text, Title } from '@mantine/core'
import { IconChevronLeft, IconChevronRight, IconRefresh, IconBrandAndroid, IconBrandApple } from '@tabler/icons-react'
import StatsCards from '@/components/StatsCards'
import StatusBadge from '@/components/StatusBadge'
import SectionToggle from '@/components/SectionToggle'
import SlackPreview from '@/lib/SlackPreview'
import { formatExecutionTime } from '@/lib/utils'
import { useReportHistory } from '@/lib/reports/useReportHistory'
import type { Platform } from '@/lib/types'
import type {
  ReportExecution,
  WeeklyReportData,
  WeeklyIssue,
  NewIssue,
  WeeklySurgeIssue,
} from '@/lib/reports/types'

interface WeeklyReportPageProps {
  platform: Platform
  title: string
  description: string
  cardTitle: string
}

type WeeklyReportPayload = (WeeklyReportData & { slack_blocks?: unknown }) | undefined

type NormalizedIssue = {
  issueId: string
  title: string
  events: number
  users: number
  link?: string
}

type NormalizedNewIssue = {
  issueId: string
  title: string
  events?: number | null
  link?: string
}

type NormalizedSurgeIssue = {
  issueId: string
  title: string
  events: number
  prevEvents: number
  growth: number
  link?: string
}

const formatPercent = (value?: number | null) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '-'
  const percent = value <= 1 ? value * 100 : value
  return `${percent.toFixed(1)}%`
}

const formatCount = (value?: number | null) => {
  if (value === null || value === undefined) return '-'
  return value
}

const normalizeWeeklyIssues = (items?: WeeklyIssue[]): NormalizedIssue[] => {
  if (!Array.isArray(items)) return []
  return items.map((issue, idx) => ({
    issueId: issue.issue_id || issue.short_id || `issue-${idx}`,
    title: issue.title || '제목 없음',
    events: issue.events ?? 0,
    users: issue.users ?? 0,
    link: issue.link || undefined,
  }))
}

const normalizeNewIssues = (items?: NewIssue[]): NormalizedNewIssue[] => {
  if (!Array.isArray(items)) return []
  return items.map((issue, idx) => ({
    issueId: issue.issue_id || `new-${idx}`,
    title: issue.title || '제목 없음',
    events: issue.event_count ?? null,
    link: issue.link || undefined,
  }))
}

const normalizeSurgeIssues = (items?: WeeklySurgeIssue[]): NormalizedSurgeIssue[] => {
  if (!Array.isArray(items)) return []
  return items.map((issue, idx) => ({
    issueId: issue.issue_id || `surge-${idx}`,
    title: issue.title || '제목 없음',
    events: issue.event_count ?? 0,
    prevEvents: issue.prev_count ?? 0,
    growth: issue.growth_multiplier ?? 0,
    link: issue.link || undefined,
  }))
}

const buildWeeklyDateKey = (report?: ReportExecution) => {
  if (!report) return ''
  if (report.start_date && report.end_date) {
    return `${report.start_date}~${report.end_date}`
  }
  return report.target_date ?? ''
}

export default function WeeklyReportPage({ platform, title, description, cardTitle }: WeeklyReportPageProps) {
  const {
    reports,
    selectedReport,
    selectedIndex,
    isLoading,
    error,
    hasOlder,
    hasNewer,
    goOlder,
    goNewer,
    refresh,
  } = useReportHistory({ reportType: 'weekly', platform, limit: 20 })

  const [detailsReport, setDetailsReport] = useState<ReportExecution | null>(null)
  const [expandedSections, setExpandedSections] = useState({ logs: false, data: false, slack: false })
  const [issueModal, setIssueModal] = useState<{ open: boolean; item?: NormalizedIssue; dateKey?: string }>({ open: false })
  const [issueAnalysis, setIssueAnalysis] = useState<any | null>(null)
  const [issueLoading, setIssueLoading] = useState(false)
  const [issueError, setIssueError] = useState('')

  const payload = useMemo<WeeklyReportPayload>(() => {
    if (!selectedReport?.result_data) return undefined
    return selectedReport.result_data as WeeklyReportPayload
  }, [selectedReport])

  const topIssues = useMemo(() => normalizeWeeklyIssues(payload?.top5_events), [payload])
  const newIssues = useMemo(() => normalizeNewIssues(payload?.new_issues), [payload])
  const surgeIssues = useMemo(() => normalizeSurgeIssues(payload?.surge_issues), [payload])

  // AI 코멘트 추출
  const aiComment = useMemo(() => {
    if (!selectedReport) return null
    
    // AI 분석 데이터는 selectedReport.ai_analysis 필드에 저장됨
    const aiAnalysis = selectedReport.ai_analysis as any
    if (!aiAnalysis) return null
    
    // newsletter_summary 필드가 AI 코멘트
    const comment = aiAnalysis.newsletter_summary
    
    return comment || null
  }, [selectedReport])

  // AI 오늘의 액션 추출
  const aiActions = useMemo(() => {
    if (!selectedReport) return []
    
    const aiAnalysis = selectedReport.ai_analysis as any
    if (!aiAnalysis || !aiAnalysis.today_actions) return []
    
    return aiAnalysis.today_actions
  }, [selectedReport])

  const summaryItems = useMemo(() => {
    if (!payload) return []
    return [
      { label: '이번 주 이벤트', value: formatCount(paylad.this_week?.events) },
      { label: '이번 주 이슈', value: formatCount(payload.this_week?.issues) },
      { label: '이번 주 사용자', value: formatCount(payload.this_week?.users) },
      { label: 'Crash Free(세션)', value: formatPercent(payload.this_week?.crash_free_sessions) },
      { label: 'Crash Free(사용자)', value: formatPercent(payload.this_week?.crash_free_users) },
    ]
  }, [payload])

  const prevSummaryText = useMemo(() => {
    if (!payload) return null
    return `지난 주 (${payload.prev_week_range_kst ?? '-'}) · 이벤트 ${formatCount(payload.prev_week?.events)}건 · 이슈 ${formatCount(payload.prev_week?.issues)}개 · 사용자 ${formatCount(payload.prev_week?.users)}명`
  }, [payload])

  const weekRangeLabel = payload?.this_week_range_kst ?? buildWeeklyDateKey(selectedReport)

  const handleOpenDetails = () => {
    if (!selectedReport) return
    setDetailsReport(selectedReport)
    setExpandedSections({ logs: false, data: false, slack: false })
  }

  const toggleSection = (section: 'logs' | 'data' | 'slack') => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }))
  }

  const renderSlackMessage = (reportData: any) => {
    if (!reportData) return '리포트 데이터가 없습니다.'

    try {
      const period = weekRangeLabel || selectedReport?.target_date || ''
      let message = `📈 *주간 크래시 리포트 - ${period}*\n\n`

      let summary
      let top
      let newCandidates
      let resolved
      let stale

      if (reportData.summary || reportData.topIssues || reportData.total_events) {
        summary = reportData.summary || {
          totalEvents: reportData.total_events,
          totalIssues: reportData.total_issues,
          totalUsers: reportData.total_users,
          newIssues: reportData.new_issues_count,
          resolvedIssues: reportData.resolved_issues_count,
        }
        top = reportData.topIssues || reportData.top_issues || []
        newCandidates = reportData.newIssues || reportData.new_issues || []
        resolved = reportData.resolvedIssues || reportData.resolved_issues || []
        stale = reportData.staleCandidates || reportData.stale_candidates || []
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
        newCandidates = data.newIssues || data.new_issues || []
        resolved = data.resolvedIssues || data.resolved_issues || []
        stale = data.staleCandidates || data.stale_candidates || []
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
        message += `🔥 *주요 이슈 (상위 ${Math.min(10, top.length)}개)*\n`
        top.slice(0, 10).forEach((issue: any, index: number) => {
          const title = issue.title || issue.culprit || issue.message || 'Unknown Error'
          const events = issue.events || issue.event_count || 0
          const users = issue.users || issue.user_count || 0
          message += `${index + 1}. ${title}\n`
          message += `   📈 ${events}건 | 👥 ${users}명\n`
        })
        message += '\n'
      }

      if (Array.isArray(newCandidates) && newCandidates.length > 0) {
        message += `🆕 *신규 이슈 (${newCandidates.length}개)*\n`
        newCandidates.slice(0, 5).forEach((issue: any) => {
          const title = issue.title || issue.culprit || issue.message || 'Unknown Error'
          message += `• ${title}\n`
        })
        message += '\n'
      }

      if (Array.isArray(resolved) && resolved.length > 0) {
        message += `✅ *해결된 이슈 (${resolved.length}개)*\n`
        resolved.slice(0, 5).forEach((issue: any) => {
          const title = issue.title || issue.culprit || issue.message || 'Unknown Error'
          message += `• ${title}\n`
        })
        message += '\n'
      }

      if (Array.isArray(stale) && stale.length > 0) {
        message += `🗑️ *정리 대상 이슈 (${stale.length}개)*\n`
        stale.slice(0, 3).forEach((issue: any) => {
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

  const openIssue = async (issue: NormalizedIssue) => {
    const dateKey = buildWeeklyDateKey(selectedReport)
    if (!dateKey) return

    setIssueModal({ open: true, item: issue, dateKey })
    setIssueAnalysis(null)
    setIssueError('')
    setIssueLoading(false)

    try {
      const res = await fetch(
        `/api/reports/issues/${encodeURIComponent(issue.issueId)}/analysis?platform=${platform}&type=weekly&dateKey=${encodeURIComponent(dateKey)}`,
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
        body: JSON.stringify({ platform, type: 'weekly', dateKey: issueModal.dateKey, force }),
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
    setIssueAnalysis(null)
    setIssueError('')
  }

  const triggerLabel = selectedReport?.trigger_type === 'scheduled' ? '🤖 자동 실행' : '🧪 테스트 실행'
  const triggerColor = selectedReport?.trigger_type === 'scheduled' ? 'blue' : 'pink'

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

      {/* 리포트 현황 개요 */}
      {selectedReport && (
        <Card withBorder radius="lg" p="xl" mt="md" style={{ background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.05) 0%, rgba(59, 130, 246, 0.05) 100%)', borderColor: 'rgba(168, 85, 247, 0.2)' }}>
          <Group justify="space-between" align="center" mb="lg">
            <div>
              <Group align="center" gap="md" mb={4}>
                <Title order={3} c="violet.6">📊 리포트 개요</Title>
                <Badge color={triggerColor} size="md" variant="filled" radius="sm">
                  {triggerLabel}
                </Badge>
              </Group>
              <Text c="dimmed" size="sm">
                {weekRangeLabel} 크래시 데이터 요약 (총 {reports.length}건 중 {selectedIndex + 1}번째)
              </Text>
              <Group gap={8} mt={8}>
                <StatusBadge kind="report" status={selectedReport.status} />
                <Text size="xs" c="dimmed">
                  {selectedReport.trigger_type === 'scheduled' ? '자동 실행' : '수동 실행'} · {formatExecutionTime(selectedReport.execution_time_ms)}
                </Text>
              </Group>
            </div>
            <Group gap="xs" wrap="nowrap">
              <Button variant="light" size="sm" onClick={handleOpenDetails}>
                리포트 상세
              </Button>
              <ActionIcon
                variant="default"
                aria-label="최근 리포트"
                onClick={goNewer}
                disabled={!hasNewer || isLoading}
                size="lg"
              >
                <IconChevronLeft size={16} />
              </ActionIcon>
              <ActionIcon
                variant="default"
                aria-label="이전 리포트"
                onClick={goOlder}
                disabled={!hasOlder || isLoading}
                size="lg"
              >
                <IconChevronRight size={16} />
              </ActionIcon>
            </Group>
          </Group>

          {error && (
            <Card withBorder p="md" mb="md" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
              <Text c="red" size="sm" fw={500}>⚠️ {error}</Text>
            </Card>
          )}

          {selectedReport.status === 'error' && (
            <Card withBorder p="md" mb="md" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
              <Text c="red" size="sm" fw={500}>⚠️ 이 실행은 실패했습니다. 상세 화면에서 오류 메시지를 확인하세요.</Text>
            </Card>
          )}

          {summaryItems.length > 0 && <StatsCards items={summaryItems} />}

          {prevSummaryText && (
            <Text size="xs" c="dimmed" ta="center" mt="md">
              📅 {prevSummaryText}
            </Text>
          )}
        </Card>
      )}

      {/* AI 분석 섹션 */}
      {(aiComment || aiActions.length > 0) && (
        <Card withBorder radius="lg" p="lg" mt="md" style={{ backgroundColor: 'rgba(16, 185, 129, 0.02)' }}>
          <Group justify="space-between" align="center" mb="lg">
            <div>
              <Group align="center" gap="xs" mb={2}>
                <IconBrandApple size={20} color="teal" style={{ display: platform === 'android' ? 'none' : 'block' }} />
                <IconBrandAndroid size={20} color="teal" style={{ display: platform === 'ios' ? 'none' : 'block' }} />
                <Title order={4} c="teal.7">AI 분석</Title>
              </Group>
              <Text size="xs" c="dimmed" mt={2}>
                AI가 분석한 이번 주 크래시 현황 및 권장 액션
              </Text>
            </div>
          </Group>

          {/* AI 코멘트 */}
          {aiComment && (
            <Card withBorder p="md" mb="md" style={{ backgroundColor: 'var(--mantine-color-dark-6)' }}>
              <Group align="center" gap="xs" mb="xs">
                <Text size="sm" fw={600} c="teal.6">💬 분석 코멘트</Text>
              </Group>
              <Text style={{ lineHeight: 1.7, whiteSpace: 'pre-wrap' }} size="sm">
                {typeof aiComment === 'string' ? aiComment : JSON.stringify(aiComment, null, 2)}
              </Text>
            </Card>
          )}

          {/* 오늘의 액션 */}
          {aiActions.length > 0 && (
            <div>
              <Group align="center" gap="xs" mb="md">
                <Text size="sm" fw={600} c="teal.6">📋 이번 주 권장 액션</Text>
                <Badge size="sm" color="teal" variant="light">{aiActions.length}개</Badge>
              </Group>
              <Grid>
                {aiActions.map((action: any, index: number) => (
                  <Grid.Col span={12} key={index}>
                    <Card withBorder p="md" style={{ backgroundColor: 'var(--mantine-color-dark-6)' }}>
                      <Text size="sm" fw={600} mb="xs" c="blue.4">
                        {action.title}
                      </Text>
                      <Text size="xs" c="dimmed" mb="xs">
                        👤 {action.owner_role} • {action.why}
                      </Text>
                      <Text size="sm" style={{ lineHeight: 1.5 }}>
                        {action.suggestion}
                      </Text>
                    </Card>
                  </Grid.Col>
                ))}
              </Grid>
            </div>
          )}
        </Card>
      )}

      {/* Top 5 이슈 섹션 */}
      <Card withBorder radius="lg" p="lg" mt="md">
        <Group justify="space-between" align="center" mb="md">
          <Title order={4}>{cardTitle}</Title>
        </Group>

        {isLoading && !selectedReport ? (
          <Text c="dimmed" ta="center" py="xl">불러오는 중…</Text>
        ) : !selectedReport ? (
          <Text c="dimmed" ta="center" py="xl">표시할 리포트가 없습니다.</Text>
        ) : (
          <Stack gap={12}>

            {topIssues.length === 0 ? (
              <Text c="dimmed" ta="center" py="xl">Top 5 이슈 데이터가 없습니다.</Text>
            ) : (
              topIssues.map((issue, idx) => (
                <Card key={issue.issueId || idx} withBorder radius="md" p="md" style={{ backgroundColor: 'rgba(255, 255, 255, 0.03)' }}>
                  <Group justify="space-between" align="center" wrap="wrap">
                    <div style={{ maxWidth: '70%' }}>
                      <Text fw={600} size="sm" mb={6}>
                        {idx + 1}. {issue.title}
                      </Text>
                      <Text c="dimmed" size="xs">
                        📈 {issue.events}건 · 👥 {issue.users}명
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
        )}
      </Card>

      {/* 신규 이슈 섹션 */}
      {newIssues.length > 0 && (
        <Card withBorder radius="lg" p="lg" mt="md" style={{ background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.05) 0%, rgba(16, 185, 129, 0.05) 100%)', borderColor: 'rgba(34, 197, 94, 0.2)' }}>
          <Title order={4} c="green.6" mb="md">🆕 신규 이슈 ({newIssues.length}개)</Title>
          <Stack gap={8}>
            {newIssues.slice(0, 5).map((issue, idx) => (
              <Card key={issue.issueId} withBorder radius="md" p="md" style={{ backgroundColor: 'rgba(34, 197, 94, 0.02)' }}>
                <Text fw={600} size="sm" mb={4}>
                  {idx + 1}. {issue.title}
                </Text>
                <Text c="dimmed" size="xs">
                  {issue.events != null ? `📈 이벤트 ${issue.events}건` : '📈 이벤트 수 미집계'}
                </Text>
              </Card>
            ))}
          </Stack>
        </Card>
      )}

      {/* 급증 이슈 섹션 */}
      {surgeIssues.length > 0 && (
        <Card withBorder radius="lg" p="lg" mt="md" style={{ background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.05) 0%, rgba(245, 101, 101, 0.05) 100%)', borderColor: 'rgba(239, 68, 68, 0.2)' }}>
          <Title order={4} c="red.6" mb="md">📈 급증 이슈 ({surgeIssues.length}개)</Title>
          <Stack gap={8}>
            {surgeIssues.slice(0, 5).map((issue, idx) => (
              <Card key={issue.issueId} withBorder radius="md" p="md" style={{ backgroundColor: 'rgba(239, 68, 68, 0.02)' }}>
                <Text fw={600} size="sm" mb={4}>
                  {idx + 1}. {issue.title}
                </Text>
                <Text c="dimmed" size="xs">
                  📈 이번 주 {issue.events}건 · 지난 주 {issue.prevEvents}건 · ×{issue.growth.toFixed(1)} 증가
                </Text>
              </Card>
            ))}
          </Stack>
        </Card>
      )}

      <Modal opened={issueModal.open} onClose={handleCloseIssueModal} title="이슈 상세" size="lg" centered>
        {issueModal.item && (
          <Stack gap="sm">
            <Text fw={600}>{issueModal.item.title}</Text>
            <Text c="dimmed" size="sm">
              📈 {issueModal.item.events}건 · 👥 {issueModal.item.users}명
            </Text>
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
        title={`리포트 결과 - ${buildWeeklyDateKey(detailsReport)}`}
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
