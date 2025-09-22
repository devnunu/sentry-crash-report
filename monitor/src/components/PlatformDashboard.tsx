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
import LoadingScreen from '@/components/LoadingScreen'

interface DashboardData {
  overall: {
    crashFreeRate: number
    totalEvents: number
    totalIssues: number
    criticalIssues: number
    affectedUsers: number
  }
  platforms: Array<{
    platform: 'android' | 'ios'
    crashFreeRate: number
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
  crashFreeRate: number
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

interface PlatformDashboardProps {
  platform: 'android' | 'ios'
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

const getPlatformConfig = (platform: 'android' | 'ios') => {
  if (platform === 'android') {
    return {
      title: 'Android 대시보드',
      description: 'Android 플랫폼 크래시 모니터링 및 이슈 추이 분석',
      icon: <IconBrandAndroid size={32} color="green" />,
      color: 'green',
      gradient: 'linear-gradient(135deg, rgba(34, 197, 94, 0.05) 0%, rgba(16, 185, 129, 0.05) 100%)',
      borderColor: 'rgba(34, 197, 94, 0.2)',
      dailyRoute: '/monitor/daily/android',
      chartColor: 'var(--mantine-color-green-6)',
      ringColor: 'green',
      eventsColor: 'blue.6'
    }
  } else {
    return {
      title: 'iOS 대시보드',
      description: 'iOS 플랫폼 크래시 모니터링 및 이슈 추이 분석',
      icon: <IconBrandApple size={32} color="blue" />,
      color: 'blue',
      gradient: 'linear-gradient(135deg, rgba(59, 130, 246, 0.05) 0%, rgba(147, 51, 234, 0.05) 100%)',
      borderColor: 'rgba(59, 130, 246, 0.2)',
      dailyRoute: '/monitor/daily/ios',
      chartColor: 'var(--mantine-color-blue-6)',
      ringColor: 'blue',
      eventsColor: 'teal.6'
    }
  }
}

export default function PlatformDashboard({ platform }: PlatformDashboardProps) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [trendData, setTrendData] = useState<TrendData[]>([])
  const [periodSummary, setPeriodSummary] = useState<PeriodSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [trendLoading, setTrendLoading] = useState(true)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState(new Date())
  const [trendDays, setTrendDays] = useState<'7' | '14' | '30'>('7')
  const [chartMetric, setChartMetric] = useState<'events' | 'issues' | 'users' | 'crashFreeRate'>('events')

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

  const fetchTrendData = async () => {
    try {
      setTrendLoading(true)
      const response = await fetch(`/api/dashboard/trends?days=${trendDays}&platform=${platform}`)
      const result: ApiResponse<TrendData[]> = await response.json()
      
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to fetch trend data')
      }
      
      setTrendData(result.data)
    } catch (err) {
      console.error('Failed to fetch trend data:', err)
    } finally {
      setTrendLoading(false)
    }
  }

  const fetchPeriodSummary = async () => {
    try {
      setSummaryLoading(true)
      const response = await fetch(`/api/dashboard/period-summary?days=${trendDays}&platform=${platform}`)
      const result: ApiResponse<PeriodSummary> = await response.json()
      
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to fetch period summary')
      }
      
      setPeriodSummary(result.data)
    } catch (err) {
      console.error('Failed to fetch period summary:', err)
      generateSummaryFromTrendData()
    } finally {
      setSummaryLoading(false)
    }
  }

  const generateSummaryFromTrendData = () => {
    if (trendData.length === 0) return
    
    const platformData = trendData.map(d => d[platform])
    const platformDataWithReports = trendData.filter(d => d[platform].events > 0 || d[platform].issues > 0 || d[platform].users > 0)
    const validData = platformData.filter(d => d.crashFreeRate > 0)
    
    if (validData.length === 0) return
    
    const totalEvents = platformData.reduce((sum, d) => sum + d.events, 0)
    const totalIssues = platformData.reduce((sum, d) => sum + d.issues, 0)
    const totalUsers = platformData.reduce((sum, d) => sum + d.users, 0)
    const avgCrashFreeRate = validData.reduce((sum, d) => sum + d.crashFreeRate, 0) / validData.length
    
    const missingDates = trendData
      .filter(d => d[platform].events === 0 && d[platform].issues === 0 && d[platform].users === 0)
      .map(d => d.date)
    
    const firstDate = trendData[0]?.date
    const lastDate = trendData[trendData.length - 1]?.date
    const dateRange = firstDate && lastDate ? `${firstDate} ~ ${lastDate}` : ''
    
    setPeriodSummary({
      crashFreeRate: Number(avgCrashFreeRate.toFixed(2)),
      totalEvents,
      totalIssues,
      criticalIssues: 0,
      affectedUsers: totalUsers,
      dateRange,
      reportCount: trendData.length,
      actualReportCount: platformDataWithReports.length,
      missingDates
    })
  }

  const handleRefresh = async () => {
    setLoading(true)
    await Promise.all([fetchDashboardData(), fetchTrendData(), fetchPeriodSummary()])
  }

  useEffect(() => {
    fetchDashboardData()
    fetchTrendData()
    fetchPeriodSummary()
  }, [])

  useEffect(() => {
    fetchTrendData()
    fetchPeriodSummary()
  }, [trendDays])

  useEffect(() => {
    if (trendData.length > 0 && !periodSummary) {
      generateSummaryFromTrendData()
    }
  }, [trendData, periodSummary])

  useEffect(() => {
    const interval = setInterval(() => {
      fetchDashboardData()
      fetchTrendData()
      fetchPeriodSummary()
    }, 5 * 60 * 1000)

    return () => clearInterval(interval)
  }, [trendDays])

  const chartData = useMemo(() => {
    return trendData
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map(item => ({
        date: new Date(item.date).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }),
        fullDate: item.date,
        [platform === 'android' ? 'Android' : 'iOS']: item[platform][chartMetric]
      }))
  }, [trendData, chartMetric, platform])

  // Crash Free Rate 차트용 동적 Y축 범위 계산
  const crashFreeRateRange = useMemo(() => {
    if (chartMetric !== 'crashFreeRate' || chartData.length === 0) {
      return [95, 100]
    }
    
    const values = chartData
      .map(item => item[platform === 'android' ? 'Android' : 'iOS'] as number)
      .filter(val => val > 0 && val <= 100)
    
    if (values.length === 0) {
      return [95, 100]
    }
    
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min
    
    // 범위가 너무 작으면 최소 1% 정도의 여백을 둠
    const minRange = 1
    const actualRange = Math.max(range, minRange)
    
    // 위아래로 10% 정도 여백 추가
    const padding = actualRange * 0.1
    const yMin = Math.max(0, min - padding)
    const yMax = Math.min(100, max + padding)
    
    // 소수점 한 자리로 반올림
    return [
      Math.floor(yMin * 10) / 10,
      Math.ceil(yMax * 10) / 10
    ]
  }, [chartData, chartMetric, platform])

  const criticalIssuesCount = data?.recentIssues.filter(issue => issue.severity === 'critical').length || 0
  const platformInfo = data?.platforms.find(p => p.platform === platform)
  
  const displayData = periodSummary || {
    crashFreeRate: platformInfo?.crashFreeRate || 0,
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
              value={trendDays}
              onChange={(value) => setTrendDays(value as typeof trendDays)}
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
          <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
            <Card withBorder p="md" style={{ backgroundColor: `rgba(${platform === 'android' ? '34, 197, 94' : '59, 130, 246'}, 0.05)`, minHeight: '100px' }}>
              <Group justify="space-between" align="center" h="100%">
                <div>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                    Crash Free Rate
                  </Text>
                  <Text size="xl" fw={700} c={`${config.color}.6`}>
                    {displayData.crashFreeRate}%
                  </Text>
                </div>
                <RingProgress
                  size={60}
                  thickness={6}
                  sections={[{ value: displayData.crashFreeRate, color: config.ringColor }]}
                />
              </Group>
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
            <Card withBorder p="md" style={{ backgroundColor: 'rgba(34, 197, 94, 0.05)', minHeight: '100px' }}>
              <Group justify="space-between" align="center" h="100%">
                <div>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                    고유 이슈
                  </Text>
                  <Text size="xl" fw={700} c="green.6">
                    {displayData.totalIssues}개
                  </Text>
                </div>
                <IconBug size={32} color="green" />
              </Group>
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
            <Card withBorder p="md" style={{ backgroundColor: 'rgba(168, 85, 247, 0.05)', minHeight: '100px' }}>
              <Group justify="space-between" align="center" h="100%">
                <div>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                    영향 받은 사용자
                  </Text>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Text size="xl" fw={700} c="violet.6">
                      {formatNumber(displayData.affectedUsers)}명
                    </Text>
                    {platformInfo && getTrendIcon(platformInfo.trend, 20)}
                  </div>
                </div>
                <IconUsers size={32} color="violet" />
              </Group>
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
            <Card withBorder p="md" style={{ backgroundColor: platform === 'android' ? 'rgba(59, 130, 246, 0.05)' : 'rgba(16, 185, 129, 0.05)', minHeight: '100px' }}>
              <Group justify="space-between" align="center" h="100%">
                <div>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                    총 이벤트
                  </Text>
                  <Text size="xl" fw={700} c={config.eventsColor}>
                    {formatNumber(displayData.totalEvents)}건
                  </Text>
                </div>
                <IconBug size={32} color={platform === 'android' ? 'blue' : 'teal'} />
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

      {/* Trend Chart */}
      <Card withBorder radius="lg" p="lg" mb="lg">
        <Group justify="space-between" align="center" mb="lg">
          <Group gap="md">
            <IconChartLine size={20} color={config.chartColor} />
            <div>
              <Title order={4}>이슈 발생 트렌드</Title>
              <Text size="xs" c="dimmed" mt={2}>
                생성된 일간 리포트 데이터 기반 ({trendDays}일간)
              </Text>
            </div>
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
          </Group>
        </Group>

        {trendLoading ? (
          <Group justify="center" align="center" style={{ height: '300px' }}>
            <Text c="dimmed">차트 데이터 로딩 중...</Text>
          </Group>
        ) : chartData.length === 0 ? (
          <Group justify="center" align="center" style={{ height: '300px' }}>
            <Stack align="center" gap="sm">
              <Text c="dimmed">표시할 트렌드 데이터가 없습니다</Text>
              <Text size="xs" c="dimmed">
                {platform.toUpperCase()} 일간 리포트가 생성되지 않았거나 데이터가 없습니다
              </Text>
            </Stack>
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
                    domain={crashFreeRateRange}
                    tickFormatter={(value) => `${value.toFixed(1)}%`}
                  />
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'var(--mantine-color-dark-7)',
                      border: '1px solid var(--mantine-color-gray-4)',
                      borderRadius: '8px'
                    }}
                    formatter={(value: number) => [`${value.toFixed(2)}%`, platform.toUpperCase()]}
                    labelFormatter={(label) => `날짜: ${label}`}
                  />
                  <Area 
                    type="monotone" 
                    dataKey={platform === 'android' ? 'Android' : 'iOS'} 
                    stroke={config.chartColor}
                    fill="var(--mantine-color-blue-1)"
                    strokeWidth={3}
                    name={platform.toUpperCase()}
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
                    formatter={(value: number) => [value.toLocaleString(), platform.toUpperCase()]}
                    labelFormatter={(label) => `날짜: ${label}`}
                  />
                  <Line 
                    type="monotone" 
                    dataKey={platform === 'android' ? 'Android' : 'iOS'} 
                    stroke={config.chartColor}
                    strokeWidth={3}
                    dot={{ fill: config.chartColor, strokeWidth: 2, r: 4 }}
                    activeDot={{ r: 6, stroke: config.chartColor, strokeWidth: 2 }}
                    name={platform.toUpperCase()}
                  />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
        
      </Card>

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
              .map((issue, index) => (
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