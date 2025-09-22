'use client'

import React, { useMemo, useState } from 'react'
import { 
  ActionIcon, 
  Badge, 
  Button, 
  Card, 
  Group, 
  Modal, 
  Stack, 
  Text, 
  Title,
  Grid,
  Alert,
  RingProgress
} from '@mantine/core'
import { 
  IconChevronLeft, 
  IconChevronRight, 
  IconRefresh,
  IconBrandAndroid,
  IconBrandApple,
  IconBug,
  IconUsers,
  IconAlertTriangle,
  IconShield,
  IconFileAnalytics,
  IconList
} from '@tabler/icons-react'
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

interface DailyReportComponentProps {
  platform: Platform
}

function getPlatformConfig(platform: Platform) {
  if (platform === 'android') {
    return {
      title: 'Android 일간 리포트',
      description: 'Android 플랫폼의 Sentry 일간 크래시 리포트를 생성하고 관리합니다.',
      icon: <IconBrandAndroid size={32} color="green" />,
      color: 'green',
      gradient: 'linear-gradient(135deg, rgba(34, 197, 94, 0.05) 0%, rgba(16, 185, 129, 0.05) 100%)',
      borderColor: 'rgba(34, 197, 94, 0.2)',
      ringColor: 'green'
    }
  } else {
    return {
      title: 'iOS 일간 리포트',
      description: 'iOS 플랫폼의 Sentry 일간 크래시 리포트를 생성하고 관리합니다.',
      icon: <IconBrandApple size={32} color="blue" />,
      color: 'blue',
      gradient: 'linear-gradient(135deg, rgba(59, 130, 246, 0.05) 0%, rgba(147, 51, 234, 0.05) 100%)',
      borderColor: 'rgba(59, 130, 246, 0.2)',
      ringColor: 'blue'
    }
  }
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

const formatNumber = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '0'
  return value.toLocaleString()
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

export default function DailyReportComponent({ platform }: DailyReportComponentProps) {
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
  } = useReportHistory({ reportType: 'daily', platform, limit: 20 })

  const [expandedSections, setExpandedSections] = useState({ logs: false, data: false, slack: false, report: false })
  const [issueModal, setIssueModal] = useState<{ open: boolean; item?: NormalizedIssue; dateKey?: string }>({ open: false })
  const [issueAnalysis, setIssueAnalysis] = useState<any | null>(null)
  const [issueLoading, setIssueLoading] = useState(false)
  const [issueError, setIssueError] = useState('')

  const config = getPlatformConfig(platform)

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
  
  const criticalIssues = useMemo(() => {
    return topIssues.filter(issue => issue.events > 500 || (issue.users && issue.users > 100))
  }, [topIssues])

  const dateLabel = formatDateLabel(selectedReport?.target_date)

  const handleOpenDetails = () => {
    // 섹션으로 스크롤
    const element = document.querySelector('[data-testid="report-details-section"]')
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const toggleSection = (section: 'logs' | 'data' | 'slack' | 'report') => {
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

  const triggerLabel = selectedReport?.trigger_type === 'scheduled' ? '🤖 자동 실행' : '🧪 테스트 실행'
  const triggerColor = selectedReport?.trigger_type === 'scheduled' ? 'blue' : 'pink'

  return (
    <div className="container">
      {/* 헤더 */}
      <Group justify="space-between" align="flex-start" mb="lg">
        <div>
          <Group gap="md" align="center" mb={4}>
            {config.icon}
            <Title order={2} c={`${config.color}.6`}>{config.title}</Title>
          </Group>
          <Text c="dimmed" size="sm">{config.description}</Text>
        </div>
        <Button
          variant="default"
          size="sm"
          leftSection={<IconRefresh size={16} />}
          onClick={refresh}
          loading={isLoading}
        >
          새로고침
        </Button>
      </Group>

      {/* 에러 알림 */}
      {error && (
        <Alert icon={<IconAlertTriangle size={16} />} color="red" mb="lg">
          <Text fw={600} mb={4}>⚠️ 데이터 로딩 오류</Text>
          <Text size="sm">{error}</Text>
        </Alert>
      )}

      {/* 일자 표시 */}
      {selectedReport && (
        <Group justify="space-between" align="center" mb="md">
          <Title order={2} c={`${config.color}.7`}>{dateLabel}</Title>
          <Group gap="xs" wrap="nowrap">
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
      )}

      {/* 현황 카드 */}
      {selectedReport && dayData && (
        <Card withBorder radius="lg" p="lg" mb="lg" style={{ background: config.gradient, borderColor: config.borderColor }}>
          <Group justify="space-between" align="center" mb="lg">
            <div>
              <Group align="center" gap="md" mb={4}>
                <IconFileAnalytics size={20} color={config.color} />
                <Title order={3} c={`${config.color}.6`}>리포트 요약</Title>
                <Badge color={triggerColor} size="md" variant="filled" radius="sm">
                  {triggerLabel}
                </Badge>
                <StatusBadge kind="report" status={selectedReport.status} />
              </Group>
              <Text c="dimmed" size="sm">
                크래시 데이터 요약 (총 {reports.length}건 중 {selectedIndex + 1}번째)
              </Text>
            </div>
          </Group>

          {selectedReport.status === 'error' && (
            <Alert icon={<IconAlertTriangle size={16} />} color="red" mb="lg">
              <Text fw={600}>⚠️ 이 실행은 실패했습니다</Text>
              <Text size="sm">상세 화면에서 오류 메시지를 확인하세요.</Text>
            </Alert>
          )}

          <Grid>
            <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
              <Card withBorder p="md" style={{ backgroundColor: 'rgba(34, 197, 94, 0.05)', minHeight: '100px' }}>
                <Group justify="space-between" align="center" h="100%">
                  <div>
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                      Crash Free Rate (세션)
                    </Text>
                    <Text size="xl" fw={700} c={`${config.color}.6`}>
                      {toPercent(dayData.crash_free_sessions_pct)}
                    </Text>
                  </div>
                  <RingProgress
                    size={60}
                    thickness={6}
                    sections={[{ 
                      value: dayData.crash_free_sessions_pct ? 
                        (dayData.crash_free_sessions_pct <= 1 ? dayData.crash_free_sessions_pct * 100 : dayData.crash_free_sessions_pct) : 
                        100, 
                      color: config.ringColor 
                    }]}
                  />
                </Group>
              </Card>
            </Grid.Col>

            <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
              <Card withBorder p="md" style={{ backgroundColor: 'rgba(59, 130, 246, 0.05)', minHeight: '100px' }}>
                <Group justify="space-between" align="center" h="100%">
                  <div>
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                      총 이벤트
                    </Text>
                    <Text size="xl" fw={700} c="blue.6">
                      {formatNumber(dayData.crash_events)}건
                    </Text>
                  </div>
                  <IconBug size={32} color="blue" />
                </Group>
              </Card>
            </Grid.Col>

            <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
              <Card withBorder p="md" style={{ backgroundColor: 'rgba(168, 85, 247, 0.05)', minHeight: '100px' }}>
                <Group justify="space-between" align="center" h="100%">
                  <div>
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                      고유 이슈
                    </Text>
                    <Text size="xl" fw={700} c="violet.6">
                      {formatNumber(dayData.unique_issues || dayData.issues_count)}개
                    </Text>
                  </div>
                  <IconBug size={32} color="violet" />
                </Group>
              </Card>
            </Grid.Col>

            <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
              <Card withBorder p="md" style={{ backgroundColor: 'rgba(239, 68, 68, 0.05)', minHeight: '100px' }}>
                <Group justify="space-between" align="center" h="100%">
                  <div>
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                      영향받은 사용자
                    </Text>
                    <Text size="xl" fw={700} c="red.6">
                      {formatNumber(dayData.impacted_users)}명
                    </Text>
                  </div>
                  <IconUsers size={32} color="red" />
                </Group>
              </Card>
            </Grid.Col>
          </Grid>

          {dayData.window_utc?.start && dayData.window_utc?.end && (
            <Text size="xs" c="dimmed" ta="center" mt="lg">
              📅 집계 구간 (KST 기준): {formatKST(dayData.window_utc.start)} ~ {formatKST(dayData.window_utc.end)}
            </Text>
          )}
        </Card>
      )}

      {/* Top 5 이슈 섹션 */}
      <Card withBorder radius="lg" p="lg" mb="lg">
        <Group justify="space-between" align="center" mb="lg">
          <div>
            <Group align="center" gap="xs" mb={2}>
              <IconList size={20} color="orange" />
              <Title order={4}>Top 5 이슈</Title>
            </Group>
            <Text size="xs" c="dimmed" mt={2}>
              발생 빈도가 높은 상위 5개 이슈
            </Text>
          </div>
        </Group>

        {isLoading && !selectedReport ? (
          <Text c="dimmed" ta="center" py="xl">불러오는 중…</Text>
        ) : !selectedReport ? (
          <Text c="dimmed" ta="center" py="xl">표시할 리포트가 없습니다.</Text>
        ) : (
          <Stack gap="xs">
            {topIssues.length === 0 ? (
              <Text c="dimmed" ta="center" py="xl">Top 5 이슈 데이터가 없습니다.</Text>
            ) : (
              topIssues.map((issue, idx) => (
                <Card key={issue.issueId || idx} withBorder p="md" style={{ backgroundColor: 'var(--mantine-color-dark-6)' }}>
                  <Group justify="space-between" align="flex-start">
                    <div style={{ flex: 1 }}>
                      <Text 
                        fw={500} 
                        size="sm" 
                        mb={4}
                        component={issue.link ? "a" : "div"}
                        href={issue.link || undefined}
                        target={issue.link ? "_blank" : undefined}
                        style={{
                          cursor: issue.link ? 'pointer' : 'default',
                          textDecoration: 'none',
                          color: issue.link ? 'var(--mantine-color-blue-6)' : 'inherit'
                        }}
                        onMouseEnter={(e) => {
                          if (issue.link) {
                            e.currentTarget.style.textDecoration = 'underline'
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (issue.link) {
                            e.currentTarget.style.textDecoration = 'none'
                          }
                        }}
                      >
                        {idx + 1}. {issue.title}
                      </Text>
                      <Group gap="md" wrap="nowrap">
                        <Text size="xs" c="dimmed">
                          <IconBug size={12} style={{ display: 'inline', marginRight: 4 }} />
                          이벤트: {formatNumber(issue.events)}건
                        </Text>
                        {issue.users != null && (
                          <Text size="xs" c="dimmed">
                            <IconUsers size={12} style={{ display: 'inline', marginRight: 4 }} />
                            사용자: {formatNumber(issue.users)}명
                          </Text>
                        )}
                      </Group>
                    </div>
                    <Group gap={8}>
                      <Button variant="light" size="xs" onClick={() => openIssue(issue)}>
                        AI 분석
                      </Button>
                    </Group>
                  </Group>
                </Card>
              ))
            )}
          </Stack>
        )}
      </Card>

      {/* Critical 이슈 섹션 */}
      <Card withBorder p="lg" style={{ backgroundColor: 'rgba(239, 68, 68, 0.02)' }}>
        <Group justify="space-between" align="center" mb="md">
          <div>
            <Group gap="xs" align="center">
              <IconAlertTriangle size={20} color="red" />
              <Title order={4} c="red.7">Critical 이슈</Title>
            </Group>
            <Text size="xs" c="dimmed" mt={2}>
              즉시 처리가 필요한 높은 우선순위 이슈들 (사용자 100명 이상 또는 이벤트 500건 이상)
            </Text>
          </div>
          <Badge color="red" variant="light" size="lg">
            {criticalIssues.length}개
          </Badge>
        </Group>

        {criticalIssues.length > 0 ? (
          <Stack gap="xs">
            {criticalIssues.map((issue, index) => (
              <Card key={issue.issueId} withBorder p="md" style={{ backgroundColor: 'var(--mantine-color-dark-5)' }}>
                <Group justify="space-between" align="flex-start">
                  <div style={{ flex: 1 }}>
                    <Text fw={500} size="sm" c="red.8" mb={4}>
                      {issue.title}
                    </Text>
                    <Group gap="md" wrap="nowrap">
                      <Text size="xs" c="dimmed">
                        <IconBug size={12} style={{ display: 'inline', marginRight: 4 }} />
                        이벤트: {formatNumber(issue.events)}건
                      </Text>
                      {issue.users != null && (
                        <Text size="xs" c="dimmed">
                          <IconUsers size={12} style={{ display: 'inline', marginRight: 4 }} />
                          사용자: {formatNumber(issue.users)}명
                        </Text>
                      )}
                    </Group>
                  </div>
                  <div>
                    <Badge 
                      color="red" 
                      variant="filled" 
                      size="sm"
                      leftSection={<IconAlertTriangle size={12} />}
                    >
                      CRITICAL
                    </Badge>
                  </div>
                </Group>
              </Card>
            ))}
          </Stack>
        ) : (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <IconShield size={48} color="green" style={{ opacity: 0.5, marginBottom: '1rem' }} />
            <Text c="dimmed" size="sm">
              현재 Critical 이슈가 없습니다
            </Text>
          </div>
        )}
      </Card>

      {/* 리포트 실행 결과 섹션 */}
      {selectedReport && (
        <Card withBorder radius="lg" p="lg" mt="lg" style={{ backgroundColor: 'rgba(99, 102, 241, 0.02)' }} data-testid="report-details-section">
          <Group justify="space-between" align="center" mb="lg">
            <div>
              <SectionToggle open={expandedSections.report} onClick={() => toggleSection('report')} label="📋 리포트 실행 결과" />
              <Text size="xs" c="dimmed" mt={2}>
                리포트 생성 과정 및 결과 상세 정보
              </Text>
            </div>
          </Group>

          {expandedSections.report && (
            <>
              {/* 실행 정보 카드 */}
              <Grid mb="lg">
            <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
              <Card withBorder p="md" style={{ backgroundColor: 'var(--mantine-color-dark-6)', minHeight: '80px' }}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={4}>실행 상태</Text>
                <Text fw={600} c={selectedReport.status === 'success' ? 'green.6' : selectedReport.status === 'error' ? 'red.6' : 'yellow.6'}>
                  {selectedReport.status === 'success' ? '✅ 성공' : selectedReport.status === 'error' ? '❌ 실패' : '🔄 실행중'}
                </Text>
              </Card>
            </Grid.Col>

            <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
              <Card withBorder p="md" style={{ backgroundColor: 'var(--mantine-color-dark-6)', minHeight: '80px' }}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={4}>실행 방식</Text>
                <Text fw={600} c="blue.6">
                  {selectedReport.trigger_type === 'scheduled' ? '🤖 자동' : '🧪 수동'}
                </Text>
              </Card>
            </Grid.Col>

            <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
              <Card withBorder p="md" style={{ backgroundColor: 'var(--mantine-color-dark-6)', minHeight: '80px' }}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={4}>실행 시간</Text>
                <Text fw={600} c="violet.6">
                  {formatExecutionTime(selectedReport.execution_time_ms)}
                </Text>
              </Card>
            </Grid.Col>

            <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
              <Card withBorder p="md" style={{ backgroundColor: 'var(--mantine-color-dark-6)', minHeight: '80px' }}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={4}>Slack 전송</Text>
                <Text fw={600} c={selectedReport.slack_sent ? 'green.6' : 'red.6'}>
                  {selectedReport.slack_sent ? '✅ 성공' : '❌ 실패'}
                </Text>
              </Card>
            </Grid.Col>
          </Grid>

          {/* 오류 메시지 */}
          {selectedReport.error_message && (
            <Alert icon={<IconAlertTriangle size={16} />} color="red" mb="lg">
              <Text fw={600} mb={4}>오류 메시지</Text>
              <Text size="sm">{selectedReport.error_message}</Text>
            </Alert>
          )}

          {/* 실행 로그 */}
          {Array.isArray(selectedReport.execution_logs) && selectedReport.execution_logs.length > 0 && (
            <Card withBorder p="md" mb="lg" style={{ backgroundColor: 'var(--mantine-color-dark-6)' }}>
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
                    color: 'var(--mantine-color-gray-3)',
                  }}
                >
                  {(selectedReport.execution_logs as string[]).join('\n')}
                </pre>
              )}
            </Card>
          )}

          {/* 리포트 데이터 */}
          {selectedReport.result_data && (
            <Card withBorder p="md" mb="lg" style={{ backgroundColor: 'var(--mantine-color-dark-6)' }}>
              <SectionToggle open={expandedSections.data} onClick={() => toggleSection('data')} label="리포트 원본 데이터" />
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
                    color: 'var(--mantine-color-gray-3)',
                  }}
                >
                  {JSON.stringify(selectedReport.result_data, null, 2)}
                </pre>
              )}
            </Card>
          )}

          {/* Slack 미리보기 */}
          {selectedReport.result_data && (
            <Card withBorder p="md" style={{ backgroundColor: 'var(--mantine-color-dark-6)' }}>
              <SectionToggle open={expandedSections.slack} onClick={() => toggleSection('slack')} label="Slack 메시지 미리보기" />
              {expandedSections.slack && (
                <Card withBorder radius="md" p="md" mt={8} style={{ backgroundColor: 'var(--mantine-color-gray-1)' }}>
                  {(() => {
                    const blocks = (selectedReport.result_data as any)?.slack_blocks
                    if (Array.isArray(blocks) && blocks.length > 0) {
                      return <SlackPreview blocks={blocks} />
                    }
                    return <Text c="dimmed" size="sm">Slack 메시지 미리보기를 생성할 수 없습니다.</Text>
                  })()}
                </Card>
              )}
            </Card>
          )}
            </>
          )}
        </Card>
      )}

      {/* 이슈 분석 모달 */}
      <Modal opened={issueModal.open} onClose={handleCloseIssueModal} title="이슈 상세 분석" size="lg" centered>
        {issueModal.item && (
          <Stack gap="sm">
            <Text fw={600}>{issueModal.item.title}</Text>
            <Text c="dimmed" size="sm">
              📈 {formatNumber(issueModal.item.events)}건{issueModal.item.users != null ? ` · 👥 ${formatNumber(issueModal.item.users)}명` : ''}
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

    </div>
  )
}