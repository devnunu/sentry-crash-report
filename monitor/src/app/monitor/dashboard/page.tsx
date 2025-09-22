'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { 
  Card, 
  Group, 
  Text, 
  Title, 
  Stack, 
  Grid, 
  Badge, 
  Button,
  RingProgress,
  Progress,
  ActionIcon,
  Alert,
  SegmentedControl
} from '@mantine/core'
import { 
  IconRefresh, 
  IconTrendingUp, 
  IconTrendingDown, 
  IconAlertTriangle,
  IconDeviceMobile,
  IconBrandAndroid,
  IconBrandApple,
  IconUsers,
  IconBug,
  IconShield,
  IconArrowRight,
  IconChartLine
} from '@tabler/icons-react'
import Link from 'next/link'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'

interface PlatformMetrics {
  platform: 'android' | 'ios'
  crashFreeRate: number
  totalEvents: number
  totalIssues: number
  criticalIssues: number
  affectedUsers: number
  trend: 'up' | 'down' | 'stable'
  trendPercent: number
}

interface DashboardData {
  overall: {
    crashFreeRate: number
    totalEvents: number
    totalIssues: number
    criticalIssues: number
    affectedUsers: number
  }
  platforms: PlatformMetrics[]
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

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

interface TrendData {
  date: string
  android: {
    events: number
    issues: number
    users: number
    crashFreeRate: number
  }
  ios: {
    events: number
    issues: number
    users: number
    crashFreeRate: number
  }
  total: {
    events: number
    issues: number
    users: number
    crashFreeRate: number
  }
}

const formatNumber = (num: number) => {
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}k`
  }
  return num.toString()
}

const getSeverityColor = (severity: string) => {
  switch (severity) {
    case 'critical': return 'red'
    case 'high': return 'orange'
    case 'medium': return 'yellow'
    case 'low': return 'gray'
    default: return 'gray'
  }
}

const getTrendIcon = (trend: string, size = 16) => {
  switch (trend) {
    case 'up': return <IconTrendingUp size={size} color="red" />
    case 'down': return <IconTrendingDown size={size} color="green" />
    default: return null
  }
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [trendData, setTrendData] = useState<TrendData[]>([])
  const [loading, setLoading] = useState(true)
  const [trendLoading, setTrendLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState(new Date())
  const [trendDays, setTrendDays] = useState<'7' | '14' | '30'>('7')
  const [chartMetric, setChartMetric] = useState<'events' | 'issues' | 'users' | 'crashFreeRate'>('events')

  const fetchDashboardData = async () => {
    try {
      setError(null)
      const response = await fetch('/api/dashboard/overview')
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

  const fetchTrendData = async () => {
    try {
      setTrendLoading(true)
      console.log(`[Dashboard] Fetching trend data for ${trendDays} days`)
      const response = await fetch(`/api/dashboard/trends?days=${trendDays}`)
      const result: ApiResponse<TrendData[]> = await response.json()
      
      console.log('[Dashboard] Trend API response:', result)
      
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to fetch trend data')
      }
      
      console.log('[Dashboard] Setting trend data:', result.data)
      setTrendData(result.data)
    } catch (err) {
      console.error('Failed to fetch trend data:', err)
      // 트렌드 데이터는 메인 데이터보다 중요도가 낮으므로 에러를 표시하지 않음
    } finally {
      setTrendLoading(false)
    }
  }

  const handleRefresh = async () => {
    setLoading(true)
    await Promise.all([fetchDashboardData(), fetchTrendData()])
  }

  // 초기 데이터 로드
  useEffect(() => {
    fetchDashboardData()
    fetchTrendData()
  }, [])

  // 트렌드 기간 변경 시 트렌드 데이터 다시 로드
  useEffect(() => {
    fetchTrendData()
  }, [trendDays])

  // 자동 새로고침 (5분마다)
  useEffect(() => {
    const interval = setInterval(() => {
      fetchDashboardData()
      fetchTrendData()
    }, 5 * 60 * 1000) // 5분

    return () => clearInterval(interval)
  }, [trendDays])

  // 차트 데이터 포맷팅
  const chartData = useMemo(() => {
    console.log('[Dashboard] Processing chart data:', { trendData, chartMetric })
    const result = trendData.map(item => ({
      date: new Date(item.date).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }),
      fullDate: item.date,
      Android: item.android[chartMetric],
      iOS: item.ios[chartMetric],
      Total: item.total[chartMetric]
    }))
    console.log('[Dashboard] Chart data result:', result)
    return result
  }, [trendData, chartMetric])

  const criticalIssuesCount = data?.recentIssues.filter(issue => issue.severity === 'critical').length || 0

  // 로딩 상태
  if (loading && !data) {
    return (
      <div className="container">
        <Group justify="center" align="center" style={{ minHeight: '400px' }}>
          <Stack align="center" gap="md">
            <Text size="lg">대시보드 데이터를 불러오는 중...</Text>
            <Text size="sm" c="dimmed">최신 리포트 데이터를 분석하고 있습니다</Text>
          </Stack>
        </Group>
      </div>
    )
  }

  // 에러 상태
  if (error && !data) {
    return (
      <div className="container">
        <Alert icon={<IconAlertTriangle size={16} />} color="red" variant="light">
          <Group justify="space-between" align="center">
            <div>
              <Text fw={600} mb={4}>대시보드 데이터를 불러올 수 없습니다</Text>
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

  // 데이터가 없는 상태
  if (!data) {
    return (
      <div className="container">
        <Alert icon={<IconAlertTriangle size={16} />} color="yellow" variant="light">
          <Text fw={600} mb={4}>표시할 데이터가 없습니다</Text>
          <Text size="sm">리포트가 생성되지 않았거나 데이터가 없습니다.</Text>
        </Alert>
      </div>
    )
  }

  return (
    <div className="container">
      {/* Header */}
      <Group justify="space-between" align="flex-start" mb="lg">
        <div>
          <Title order={2}>📊 통합 대시보드</Title>
          <Text c="dimmed" size="sm">
            실시간 크래시 모니터링 및 이슈 추이 분석
          </Text>
        </div>
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
              🚨 긴급 처리 필요: {criticalIssuesCount}개의 Critical 이슈가 발견되었습니다
            </Text>
            <Button size="xs" color="red" variant="light">
              즉시 확인
            </Button>
          </Group>
        </Alert>
      )}

      {/* Overall Metrics */}
      <Card withBorder radius="lg" p="xl" mb="lg" style={{ 
        background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.05) 0%, rgba(147, 51, 234, 0.05) 100%)', 
        borderColor: 'rgba(59, 130, 246, 0.2)' 
      }}>
        <Group justify="space-between" align="center" mb="lg">
          <Title order={3} c="blue.6">🎯 전체 현황</Title>
          <Badge color="blue" size="lg" variant="filled">
            실시간
          </Badge>
        </Group>
        
        <Grid>
          <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
            <Card withBorder p="md" style={{ backgroundColor: 'rgba(34, 197, 94, 0.05)' }}>
              <Group justify="space-between" align="center">
                <div>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                    Crash Free Rate
                  </Text>
                  <Text size="xl" fw={700} c="green.6">
                    {data.overall.crashFreeRate}%
                  </Text>
                </div>
                <RingProgress
                  size={60}
                  thickness={6}
                  sections={[{ value: data.overall.crashFreeRate, color: 'green' }]}
                />
              </Group>
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
            <Card withBorder p="md" style={{ backgroundColor: 'rgba(239, 68, 68, 0.05)' }}>
              <Group justify="space-between" align="center">
                <div>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                    Critical 이슈
                  </Text>
                  <Text size="xl" fw={700} c="red.6">
                    {data.overall.criticalIssues}개
                  </Text>
                </div>
                <IconAlertTriangle size={32} color="red" />
              </Group>
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
            <Card withBorder p="md" style={{ backgroundColor: 'rgba(168, 85, 247, 0.05)' }}>
              <Group justify="space-between" align="center">
                <div>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                    영향 받은 사용자
                  </Text>
                  <Text size="xl" fw={700} c="violet.6">
                    {formatNumber(data.overall.affectedUsers)}명
                  </Text>
                </div>
                <IconUsers size={32} color="violet" />
              </Group>
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
            <Card withBorder p="md" style={{ backgroundColor: 'rgba(59, 130, 246, 0.05)' }}>
              <Group justify="space-between" align="center">
                <div>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                    총 이벤트
                  </Text>
                  <Text size="xl" fw={700} c="blue.6">
                    {formatNumber(data.overall.totalEvents)}건
                  </Text>
                </div>
                <IconBug size={32} color="blue" />
              </Group>
            </Card>
          </Grid.Col>
        </Grid>
      </Card>

      {/* Trend Chart */}
      <Card withBorder radius="lg" p="lg" mb="lg">
        <Group justify="space-between" align="center" mb="lg">
          <Group gap="md">
            <IconChartLine size={20} color="var(--mantine-color-blue-6)" />
            <Title order={4}>📈 이슈 발생 트렌드</Title>
          </Group>
          <Group gap="md">
            <SegmentedControl
              value={chartMetric}
              onChange={(value) => setChartMetric(value as typeof chartMetric)}
              data={[
                { label: '이벤트', value: 'events' },
                { label: '이슈', value: 'issues' },
                { label: '사용자', value: 'users' },
                { label: 'Crash Free %', value: 'crashFreeRate' }
              ]}
              size="xs"
            />
            <SegmentedControl
              value={trendDays}
              onChange={(value) => setTrendDays(value as typeof trendDays)}
              data={[
                { label: '7일', value: '7' },
                { label: '14일', value: '14' },
                { label: '30일', value: '30' }
              ]}
              size="xs"
            />
          </Group>
        </Group>

        {trendLoading ? (
          <Group justify="center" align="center" style={{ height: '300px' }}>
            <Text c="dimmed">차트 데이터 로딩 중...</Text>
          </Group>
        ) : chartData.length === 0 ? (
          <Group justify="center" align="center" style={{ height: '300px' }}>
            <Text c="dimmed">표시할 트렌드 데이터가 없습니다</Text>
          </Group>
        ) : (
          <div style={{ height: '300px', width: '100%' }}>
            <ResponsiveContainer>
              {chartMetric === 'crashFreeRate' ? (
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--mantine-color-gray-3)" />
                  <XAxis 
                    dataKey="date" 
                    stroke="var(--mantine-color-gray-6)"
                    fontSize={12}
                  />
                  <YAxis 
                    stroke="var(--mantine-color-gray-6)"
                    fontSize={12}
                    domain={[95, 100]}
                  />
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'var(--mantine-color-dark-7)',
                      border: '1px solid var(--mantine-color-gray-4)',
                      borderRadius: '8px'
                    }}
                    formatter={(value: number) => [`${value.toFixed(2)}%`, '']}
                    labelFormatter={(label) => `날짜: ${label}`}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="Total" 
                    stroke="var(--mantine-color-blue-6)"
                    fill="var(--mantine-color-blue-1)"
                    strokeWidth={2}
                    name="전체"
                  />
                  <Area 
                    type="monotone" 
                    dataKey="Android" 
                    stroke="var(--mantine-color-green-6)"
                    fill="var(--mantine-color-green-1)"
                    strokeWidth={2}
                    name="Android"
                  />
                  <Area 
                    type="monotone" 
                    dataKey="iOS" 
                    stroke="var(--mantine-color-violet-6)"
                    fill="var(--mantine-color-violet-1)"
                    strokeWidth={2}
                    name="iOS"
                  />
                </AreaChart>
              ) : (
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--mantine-color-gray-3)" />
                  <XAxis 
                    dataKey="date" 
                    stroke="var(--mantine-color-gray-6)"
                    fontSize={12}
                  />
                  <YAxis 
                    stroke="var(--mantine-color-gray-6)"
                    fontSize={12}
                  />
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'var(--mantine-color-dark-7)',
                      border: '1px solid var(--mantine-color-gray-4)',
                      borderRadius: '8px'
                    }}
                    formatter={(value: number) => [
                      chartMetric === 'users' || chartMetric === 'events' ? formatNumber(value) : value,
                      ''
                    ]}
                    labelFormatter={(label) => `날짜: ${label}`}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="Total" 
                    stroke="var(--mantine-color-blue-6)"
                    strokeWidth={3}
                    dot={{ r: 4 }}
                    name="전체"
                  />
                  <Line 
                    type="monotone" 
                    dataKey="Android" 
                    stroke="var(--mantine-color-green-6)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    name="Android"
                  />
                  <Line 
                    type="monotone" 
                    dataKey="iOS" 
                    stroke="var(--mantine-color-violet-6)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    name="iOS"
                  />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Platform Metrics */}
      <Card withBorder radius="lg" p="lg" mb="lg">
        <Title order={4} mb="md">📱 플랫폼별 현황</Title>
        <Stack gap="md">
          {data.platforms.map((platform) => (
            <Card 
              key={platform.platform}
              withBorder 
              p="md" 
              style={{ 
                backgroundColor: platform.platform === 'android' 
                  ? 'rgba(34, 197, 94, 0.02)' 
                  : 'rgba(59, 130, 246, 0.02)' 
              }}
            >
              <Group justify="space-between" align="center">
                <Group gap="md">
                  {platform.platform === 'android' ? (
                    <IconBrandAndroid size={24} color="green" />
                  ) : (
                    <IconBrandApple size={24} color="blue" />
                  )}
                  <div>
                    <Text fw={600} size="sm" tt="capitalize">
                      {platform.platform}
                    </Text>
                    <Text size="xs" c="dimmed">
                      Crash Free: {platform.crashFreeRate}%
                    </Text>
                  </div>
                </Group>
                
                <Group gap="lg">
                  <div style={{ textAlign: 'center' }}>
                    <Text size="xs" c="dimmed">이슈</Text>
                    <Text fw={600}>{platform.totalIssues}개</Text>
                    {platform.criticalIssues > 0 && (
                      <Badge size="xs" color="red">
                        Critical {platform.criticalIssues}
                      </Badge>
                    )}
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <Text size="xs" c="dimmed">이벤트</Text>
                    <Text fw={600}>{formatNumber(platform.totalEvents)}건</Text>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <Text size="xs" c="dimmed">사용자</Text>
                    <Group gap={4} justify="center">
                      <Text fw={600}>{formatNumber(platform.affectedUsers)}명</Text>
                      {getTrendIcon(platform.trend, 14)}
                    </Group>
                  </div>
                  <Button 
                    component={Link}
                    href={`/monitor/daily/${platform.platform}`}
                    size="xs" 
                    variant="light"
                    rightSection={<IconArrowRight size={12} />}
                  >
                    상세보기
                  </Button>
                </Group>
              </Group>
            </Card>
          ))}
        </Stack>
      </Card>

      {/* Critical Issues */}
      <Card withBorder radius="lg" p="lg" mb="lg">
        <Group justify="space-between" align="center" mb="md">
          <Title order={4}>🔥 긴급 이슈</Title>
          <Button component={Link} href="/monitor/history" size="xs" variant="light">
            전체보기
          </Button>
        </Group>
        <Grid>
          {data.recentIssues.slice(0, 6).map((issue) => (
            <Grid.Col key={issue.id} span={{ base: 12, sm: 6, lg: 4 }}>
              <Card 
                withBorder 
                p="md" 
                style={{ 
                  backgroundColor: issue.severity === 'critical' 
                    ? 'rgba(239, 68, 68, 0.05)' 
                    : 'rgba(255, 255, 255, 0.02)',
                  height: '100%'
                }}
              >
                <Stack gap="sm" style={{ height: '100%' }}>
                  <Group gap="xs">
                    <Badge 
                      size="xs" 
                      color={getSeverityColor(issue.severity)}
                      variant="filled"
                    >
                      {issue.severity.toUpperCase()}
                    </Badge>
                    {issue.platform === 'android' ? (
                      <IconBrandAndroid size={12} color="green" />
                    ) : (
                      <IconBrandApple size={12} color="blue" />
                    )}
                    {getTrendIcon(issue.trend, 12)}
                  </Group>
                  <Text size="sm" fw={600} lineClamp={2} style={{ flex: 1 }}>
                    {issue.title}
                  </Text>
                  <Text size="xs" c="dimmed">
                    👥 {formatNumber(issue.affectedUsers)}명 · 📈 {formatNumber(issue.events)}건
                  </Text>
                </Stack>
              </Card>
            </Grid.Col>
          ))}
        </Grid>
      </Card>

      {/* Quick Actions */}
      <Card withBorder radius="lg" p="lg" mt="lg" style={{ 
        background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.05) 0%, rgba(59, 130, 246, 0.05) 100%)', 
        borderColor: 'rgba(34, 197, 94, 0.2)' 
      }}>
        <Title order={4} mb="md">⚡ 빠른 액션</Title>
        <Group gap="md">
          <Button 
            component={Link}
            href="/monitor/settings/test"
            leftSection={<IconRefresh size={16} />}
            variant="light"
            color="blue"
          >
            리포트 생성
          </Button>
          <Button 
            component={Link}
            href="/monitor/settings/schedule"
            leftSection={<IconShield size={16} />}
            variant="light"
            color="green"
          >
            스케줄 관리
          </Button>
          <Button 
            component={Link}
            href="/monitor/history"
            leftSection={<IconDeviceMobile size={16} />}
            variant="light"
            color="violet"
          >
            실행 내역
          </Button>
        </Group>
      </Card>
    </div>
  )
}