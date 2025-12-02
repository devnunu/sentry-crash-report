'use client'

import React, {useEffect, useState} from 'react'
import {Alert, Badge, Button, Card, Grid, Group, SegmentedControl, Stack, Text, Title} from '@mantine/core'
import {
  IconAlertTriangle,
  IconBrandAndroid,
  IconBrandApple,
  IconBug,
  IconChartLine,
  IconRefresh,
  IconShield,
  IconTrendingDown,
  IconTrendingUp,
  IconUsers
} from '@tabler/icons-react'
import Link from 'next/link'
import LoadingScreen from '@/components/LoadingScreen'

interface DashboardData {
  overall: {
    totalEvents: number
    totalIssues: number
    criticalIssues: number
    affectedUsers: number
  }
  platforms: Array<{
    platform: 'android' | 'ios'
    totalEvents: number
    totalIssues: number
    criticalIssues: number
    affectedUsers: number
    trend: 'up' | 'down' | 'stable'
    trendPercent: number
  }>
  recentIssues: Array<{
    id: string
    title: string
    platform: 'android' | 'ios'
    severity: 'critical' | 'high' | 'medium' | 'low'
    affectedUsers: number
    events: number
    firstSeen: string
    trend: 'up' | 'down' | 'stable'
  }>
  lastUpdated: string
}

interface PeriodSummary {
  totalEvents: number
  totalIssues: number
  criticalIssues: number
  affectedUsers: number
  dateRange: string
  reportCount: number
  actualReportCount: number
  missingDates: string[]
}

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

interface PlatformDashboardProps {
  platform: 'android' | 'ios'
}

const formatNumber = (num: number) => {
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}k`
  }
  return num.toString()
}

const getTrendIcon = (trend: string, size = 16) => {
  switch (trend) {
    case 'up': return <IconTrendingUp size={size} color="red" />
    case 'down': return <IconTrendingDown size={size} color="green" />
    default: return null
  }
}

const getPlatformConfig = (platform: 'android' | 'ios') => {
  if (platform === 'android') {
    return {
      title: 'Android 대시보드',
      description: 'Android 플랫폼 크래시 모니터링',
      icon: <IconBrandAndroid size={32} color="green" />,
      color: 'green',
      gradient: 'linear-gradient(135deg, rgba(34, 197, 94, 0.05) 0%, rgba(16, 185, 129, 0.05) 100%)',
      borderColor: 'rgba(34, 197, 94, 0.2)',
      dailyRoute: '/monitor/daily/android',
      ringColor: 'green'
    }
  } else {
    return {
      title: 'iOS 대시보드',
      description: 'iOS 플랫폼 크래시 모니터링',
      icon: <IconBrandApple size={32} color="blue" />,
      color: 'blue',
      gradient: 'linear-gradient(135deg, rgba(59, 130, 246, 0.05) 0%, rgba(147, 51, 234, 0.05) 100%)',
      borderColor: 'rgba(59, 130, 246, 0.2)',
      dailyRoute: '/monitor/daily/ios',
      ringColor: 'blue'
    }
  }
}

export default function PlatformDashboard({ platform }: PlatformDashboardProps) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [periodSummary, setPeriodSummary] = useState<PeriodSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState(new Date())
  const [periodDays, setPeriodDays] = useState<'7' | '14' | '30'>('7')

  const config = getPlatformConfig(platform)

  const fetchDashboardData = async () => {
    try {
      setError(null)
      const response = await fetch(`/api/dashboard/overview?platform=${platform}`)
      const result: ApiResponse<DashboardData> = await response.json()

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to fetch dashboard data')
      }

      setData(result.data)
      setLastRefresh(new Date())
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error occurred'
      setError(message)
      console.error('Failed to fetch dashboard data:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchPeriodSummary = async () => {
    try {
      const response = await fetch(`/api/dashboard/period-summary?days=${periodDays}&platform=${platform}`)
      const result: ApiResponse<PeriodSummary> = await response.json()

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to fetch period summary')
      }

      setPeriodSummary(result.data)
    } catch (err) {
      console.error('Failed to fetch period summary:', err)
    }
  }

  const handleRefresh = async () => {
    setLoading(true)
    await Promise.all([fetchDashboardData(), fetchPeriodSummary()])
  }

  useEffect(() => {
    fetchDashboardData()
    fetchPeriodSummary()
  }, [])

  useEffect(() => {
    fetchPeriodSummary()
  }, [periodDays])

  useEffect(() => {
    const interval = setInterval(() => {
      fetchDashboardData()
      fetchPeriodSummary()
    }, 5 * 60 * 1000)

    return () => clearInterval(interval)
  }, [periodDays])

  const criticalIssuesCount = data?.recentIssues.filter(issue => issue.severity === 'critical').length || 0
  const platformInfo = data?.platforms.find(p => p.platform === platform)

  const displayData = periodSummary || {
    totalEvents: platformInfo?.totalEvents || 0,
    totalIssues: platformInfo?.totalIssues || 0,
    criticalIssues: platformInfo?.criticalIssues || 0,
    affectedUsers: platformInfo?.affectedUsers || 0,
    dateRange: data?.lastUpdated ? new Date(data.lastUpdated).toLocaleDateString('ko-KR') : '',
    reportCount: 1
  }

  if (loading && !data) {
    return (
      <LoadingScreen
        icon={config.icon}
        title={`${config.title} 데이터를 불러오는 중...`}
        subtitle="최신 리포트 데이터를 분석하고 있습니다"
      />
    )
  }

  if (error && !data) {
    return (
      <div className="container">
        <Alert icon={<IconAlertTriangle size={16} />} color="red" variant="light">
          <Group justify="space-between" align="center">
            <div>
              <Text fw={600} mb={4}>{config.title} 데이터를 불러올 수 없습니다</Text>
              <Text size="sm">{error}</Text>
            </div>
            <Button size="sm" variant="light" onClick={handleRefresh} loading={loading}>
              다시 시도
            </Button>
          </Group>
        </Alert>
      </div>
    )
  }

  if (!data || !platformInfo) {
    return (
      <div className="container">
        <Alert icon={<IconAlertTriangle size={16} />} color="yellow" variant="light">
          <Text fw={600} mb={4}>{platform.toUpperCase()} 데이터가 없습니다</Text>
          <Text size="sm">{platform.toUpperCase()} 리포트가 생성되지 않았거나 데이터가 없습니다.</Text>
        </Alert>
      </div>
    )
  }

  return (
    <div className="container">
      {/* Header */}
      <Group justify="space-between" align="flex-start" mb="lg">
        <Group gap="md">
          {config.icon}
          <div>
            <Title order={2}>{config.title}</Title>
            <Text c="dimmed" size="sm">
              {config.description}
            </Text>
          </div>
        </Group>
        <Group gap="sm">
          <Text size="xs" c="dimmed">
            최종 업데이트: {lastRefresh.toLocaleTimeString()}
          </Text>
          <Button
            variant="default"
            size="xs"
            leftSection={<IconRefresh size={14} />}
            onClick={handleRefresh}
            loading={loading}
          >
            새로고침
          </Button>
        </Group>
      </Group>

      {/* 기간 선택기 */}
      <Card withBorder radius="lg" p="md" mb="lg" style={{
        background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.05) 0%, rgba(37, 99, 235, 0.05) 100%)',
        borderColor: 'rgba(59, 130, 246, 0.2)'
      }}>
        <Group justify="space-between" align="center">
          <div>
            <Group gap="md">
              <IconChartLine size={20} color="var(--mantine-color-blue-6)" />
              <div>
                <Text fw={600} size="sm">분석 기간 선택</Text>
                <Text size="xs" c="dimmed">
                  선택된 기간의 일간 리포트 데이터를 집계하여 표시
                </Text>
              </div>
            </Group>
          </div>
          <Group gap="md" align="center" style={{ minWidth: '200px', justifyContent: 'flex-end' }}>
            <SegmentedControl
              value={periodDays}
              onChange={(value) => setPeriodDays(value as typeof periodDays)}
              data={[
                { label: '7일', value: '7' },
                { label: '14일', value: '14' },
                { label: '30일', value: '30' }
              ]}
              size="sm"
            />
            <Badge color="blue" size="md" variant="light" style={{ minWidth: '80px', textAlign: 'center' }}>
              {periodSummary?.actualReportCount || 0}개 리포트
            </Badge>
          </Group>
        </Group>
      </Card>

      {/* Critical Alerts */}
      {criticalIssuesCount > 0 && (
        <Alert
          icon={<IconAlertTriangle size={16} />}
          color="red"
          variant="light"
          mb="lg"
        >
          <Group justify="space-between" align="center">
            <Text fw={600}>
              🚨 {platform.toUpperCase()} Critical 이슈: {criticalIssuesCount}개의 긴급 처리가 필요한 이슈가 발견되었습니다
            </Text>
            <Button
              component={Link}
              href={config.dailyRoute}
              size="xs"
              color="red"
              variant="light"
            >
              즉시 확인
            </Button>
          </Group>
        </Alert>
      )}

      {/* Platform Metrics */}
      <Card withBorder radius="lg" p="xl" mb="lg" style={{
        background: config.gradient,
        borderColor: config.borderColor
      }}>
        <Group justify="space-between" align="center" mb="lg">
          <div>
            <Title order={3} c={`${config.color}.6`}>🎯 기간별 현황</Title>
            <Text size="xs" c="dimmed" mt={4}>
              {periodSummary ?
                `기간별 집계 데이터 (${periodSummary.actualReportCount}개 리포트)` :
                '데이터 수집 중'
              }
            </Text>
          </div>
          <Badge color={periodSummary ? "blue" : config.color} size="md" variant="light">
            {periodSummary ? '기간 집계' : '리포트 기반'}
          </Badge>
        </Group>

        <Grid>
          <Grid.Col span={{ base: 12, md: 6, lg: 4 }}>
            <Card withBorder p="md" style={{ backgroundColor: 'rgba(59, 130, 246, 0.05)', minHeight: '100px' }}>
              <Group justify="space-between" align="center" h="100%">
                <div>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                    총 이벤트
                  </Text>
                  <Text size="xl" fw={700} c="blue.6">
                    {formatNumber(displayData.totalEvents)}건
                  </Text>
                </div>
                <IconBug size={32} color="blue" />
              </Group>
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 6, lg: 4 }}>
            <Card withBorder p="md" style={{ backgroundColor: 'rgba(168, 85, 247, 0.05)', minHeight: '100px' }}>
              <Group justify="space-between" align="center" h="100%">
                <div>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                    고유 이슈
                  </Text>
                  <Text size="xl" fw={700} c="violet.6">
                    {displayData.totalIssues}개
                  </Text>
                </div>
                <IconBug size={32} color="violet" />
              </Group>
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 6, lg: 4 }}>
            <Card withBorder p="md" style={{ backgroundColor: 'rgba(239, 68, 68, 0.05)', minHeight: '100px' }}>
              <Group justify="space-between" align="center" h="100%">
                <div>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                    영향받은 사용자
                  </Text>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Text size="xl" fw={700} c="red.6">
                      {formatNumber(displayData.affectedUsers)}명
                    </Text>
                    {platformInfo && getTrendIcon(platformInfo.trend, 20)}
                  </div>
                </div>
                <IconUsers size={32} color="red" />
              </Group>
            </Card>
          </Grid.Col>
        </Grid>

      </Card>

      {/* 리포트 누락 일자 알림 */}
      {periodSummary && periodSummary.missingDates.length > 0 && (
        <Alert
          icon={<IconAlertTriangle size={16} />}
          color="orange"
          variant="light"
          mb="lg"
        >
          <Text fw={600} mb={4}>
            📅 리포트가 없는 일자 ({periodSummary.missingDates.length}일)
          </Text>
          <Text size="sm" c="dimmed">
            {periodSummary.missingDates.map(date => new Date(date).toLocaleDateString('ko-KR')).join(', ')}
          </Text>
        </Alert>
      )}

      {/* Critical 이슈 섹션 */}
      <Card withBorder p="lg" mt="md" style={{ backgroundColor: 'rgba(239, 68, 68, 0.02)' }}>
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
            {criticalIssuesCount}개
          </Badge>
        </Group>

        {criticalIssuesCount > 0 ? (
          <Stack gap="xs">
            {data?.recentIssues
              .filter(issue => issue.severity === 'critical')
              .map((issue) => (
                <Card key={issue.id} withBorder p="md" style={{ backgroundColor: 'rgba(255, 255, 255, 0.5)' }}>
                  <Group justify="space-between" align="flex-start">
                    <div style={{ flex: 1 }}>
                      <Text fw={500} size="sm" c="red.8" mb={4}>
                        {issue.title}
                      </Text>
                      <Group gap="md" wrap="nowrap">
                        <Text size="xs" c="dimmed">
                          <IconUsers size={12} style={{ display: 'inline', marginRight: 4 }} />
                          영향받은 사용자: {issue.affectedUsers.toLocaleString()}명
                        </Text>
                        <Text size="xs" c="dimmed">
                          <IconBug size={12} style={{ display: 'inline', marginRight: 4 }} />
                          이벤트 수: {issue.events.toLocaleString()}건
                        </Text>
                        <Text size="xs" c="dimmed">
                          최초 발견: {new Date(issue.firstSeen).toLocaleDateString('ko-KR')}
                        </Text>
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
              ))
            }
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
    </div>
  )
}
