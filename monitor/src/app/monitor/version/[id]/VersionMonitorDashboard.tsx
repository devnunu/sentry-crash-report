'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Anchor,
  Breadcrumbs,
  Container,
  Stack,
  Group,
  Title,
  Text,
  Badge,
  Button,
  Paper,
  SimpleGrid,
  Card,
  Progress,
  Alert,
  Timeline,
  ActionIcon,
  SegmentedControl,
  Loader,
  Center
} from '@mantine/core';
import { LineChart } from '@mantine/charts';
import { notifications } from '@mantine/notifications';
import {
  IconPlayerPause,
  IconTrash,
  IconRefresh,
  IconClock,
  IconTrendingUp,
  IconCheck,
  IconAlertTriangle,
  IconAlertCircle,
  IconBell,
  IconExternalLink,
  IconPlayerPlay,
  IconHome,
  IconChevronRight
} from '@tabler/icons-react';
import Link from 'next/link';
import type { MonitorSession, MonitorHistory, VersionMonitorSnapshot } from '@/lib/types';
import {
  getProgress,
  getElapsedTime,
  getTimeRemaining,
  getDaysElapsed,
  getNextRunTime,
  getStatusColor,
  getStatusText,
  formatDateRange,
  formatDateTime,
  formatRelativeTime,
  getSentryIssueUrl,
  getMetricLabel,
  getSeverityColor,
  getSeverityText,
  formatNumber,
  formatPercentage,
  getTotalDays
} from '@/lib/monitor-helpers';

interface VersionMonitorDashboardProps {
  monitor: MonitorSession;
  snapshot: VersionMonitorSnapshot | null;
  history: MonitorHistory[];
  error?: string | null;
}

export default function VersionMonitorDashboard({
  monitor,
  snapshot: initialSnapshot,
  history: initialHistory,
  error: initialError
}: VersionMonitorDashboardProps) {
  const router = useRouter();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [chartMetric, setChartMetric] = useState<'crashes' | 'issues' | 'users' | 'cfr'>('crashes');
  const [isPaused, setIsPaused] = useState(false);
  const [currentTime, setCurrentTime] = useState<Date | null>(null);

  // 클라이언트에서만 현재 시간 설정 (하이드레이션 에러 방지)
  useEffect(() => {
    setCurrentTime(new Date());
  }, []);

  // 일시정지 상태 확인
  useEffect(() => {
    if (monitor.metadata && (monitor.metadata as any).paused) {
      setIsPaused(true);
    }
  }, [monitor.metadata]);

  // 수동 새로고침
  const handleRefresh = () => {
    setIsRefreshing(true);
    router.refresh();
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  // 일시정지
  const handlePause = async () => {
    if (!confirm('모니터링을 일시정지하시겠습니까?')) return;

    try {
      const response = await fetch(`/api/version-monitors/${monitor.id}/pause`, {
        method: 'PUT'
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to pause monitor');
      }

      notifications.show({
        title: '일시정지됨',
        message: '모니터링이 일시정지되었습니다.',
        color: 'yellow'
      });

      router.refresh();
    } catch (error) {
      notifications.show({
        title: '오류',
        message: error instanceof Error ? error.message : '일시정지 실패',
        color: 'red'
      });
    }
  };

  // 재시작
  const handleResume = async () => {
    if (!confirm('모니터링을 재시작하시겠습니까?')) return;

    try {
      const response = await fetch(`/api/version-monitors/${monitor.id}/pause`, {
        method: 'DELETE'
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to resume monitor');
      }

      notifications.show({
        title: '재시작됨',
        message: '모니터링이 재시작되었습니다.',
        color: 'green'
      });

      router.refresh();
    } catch (error) {
      notifications.show({
        title: '오류',
        message: error instanceof Error ? error.message : '재시작 실패',
        color: 'red'
      });
    }
  };

  // 중단
  const handleStop = async () => {
    if (!confirm('모니터링을 중단하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;

    try {
      const response = await fetch(`/api/version-monitors/${monitor.id}`, {
        method: 'DELETE'
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to stop monitor');
      }

      notifications.show({
        title: '중단됨',
        message: '모니터링이 중단되었습니다.',
        color: 'red'
      });

      router.push('/monitor');
    } catch (error) {
      notifications.show({
        title: '오류',
        message: error instanceof Error ? error.message : '중단 실패',
        color: 'red'
      });
    }
  };

  // 차트 데이터 준비
  const getChartData = () => {
    if (!initialSnapshot?.hourlyTrend) return [];

    return initialSnapshot.hourlyTrend.map((item) => {
      let value = 0;
      switch (chartMetric) {
        case 'crashes':
          value = item.events;
          break;
        case 'issues':
          value = item.issues;
          break;
        case 'users':
          value = item.users;
          break;
        case 'cfr':
          value = item.crashFreeRate || 0;
          break;
      }

      return {
        hour: item.hour.substring(11, 16), // HH:mm 형식
        [getMetricLabel(chartMetric)]: value
      };
    });
  };

  const totalDays = getTotalDays(monitor.started_at, monitor.expires_at);
  const progress = getProgress(monitor.started_at, monitor.expires_at);
  const elapsed = getElapsedTime(monitor.started_at);
  const remaining = getTimeRemaining(monitor.expires_at);
  const daysElapsed = getDaysElapsed(monitor.started_at);

  // 마지막 실행 시간
  const lastExecutedAt = initialHistory.length > 0 ? initialHistory[0].executed_at : null;
  const nextRunTime = lastExecutedAt
    ? getNextRunTime(lastExecutedAt, monitor.custom_interval_minutes || 60)
    : '곧 실행';

  // 브레드크럼 아이템
  const breadcrumbItems = [
    { title: '홈', href: '/monitor', icon: <IconHome size={14} /> },
    { title: '버전 모니터링', href: '/monitor' },
    {
      title: `${monitor.platform.toUpperCase()} ${monitor.base_release || monitor.matched_release}`,
      href: '#'
    }
  ].map((item, index) => (
    <Anchor
      key={index}
      component={item.href === '#' ? 'span' : Link}
      href={item.href}
      size="sm"
      c={item.href === '#' ? 'dimmed' : undefined}
    >
      <Group gap={4}>
        {item.icon}
        {item.title}
      </Group>
    </Anchor>
  ));

  return (
    <Container size="xl" py="xl">
      <Stack gap="xl">
        {/* 브레드크럼 네비게이션 */}
        <Breadcrumbs separator={<IconChevronRight size={14} />}>
          {breadcrumbItems}
        </Breadcrumbs>

        {/* Section 1: 헤더 & 액션 */}
        <Group justify="space-between" align="flex-start">
          <div>
            <Group gap="xs" mb="xs">
              <Title order={2}>
                🚀 {monitor.platform.toUpperCase()} {monitor.base_release || monitor.matched_release} 모니터링
              </Title>
              <Badge size="lg" color={getStatusColor(monitor.status)} variant="filled">
                {getStatusText(monitor.status)}
              </Badge>
              {isPaused && (
                <Badge size="lg" color="yellow" variant="filled">
                  ⏸️ 일시정지
                </Badge>
              )}
            </Group>
            <Text c="dimmed">{formatDateRange(monitor.started_at, monitor.expires_at)}</Text>
          </div>

          {/* 액션 버튼 */}
          <Group gap="xs">
            <ActionIcon
              variant="light"
              size="lg"
              onClick={handleRefresh}
              loading={isRefreshing}
              disabled={monitor.status === 'stopped' || monitor.status === 'expired'}
            >
              <IconRefresh size={18} />
            </ActionIcon>
            {isPaused ? (
              <Button
                variant="light"
                color="green"
                leftSection={<IconPlayerPlay size={16} />}
                onClick={handleResume}
                disabled={monitor.status === 'stopped' || monitor.status === 'expired'}
              >
                재시작
              </Button>
            ) : (
              <Button
                variant="light"
                leftSection={<IconPlayerPause size={16} />}
                onClick={handlePause}
                disabled={monitor.status !== 'active'}
              >
                일시정지
              </Button>
            )}
            <Button
              variant="light"
              color="red"
              leftSection={<IconTrash size={16} />}
              onClick={handleStop}
              disabled={monitor.status === 'stopped' || monitor.status === 'expired'}
            >
              중단
            </Button>
          </Group>
        </Group>

        {/* 오류 표시 */}
        {initialError && (
          <Alert icon={<IconAlertCircle />} color="red" title="데이터 로딩 실패">
            {initialError}
          </Alert>
        )}

        {/* 데이터 로딩 중 */}
        {!initialSnapshot && !initialError && (
          <Center py="xl">
            <Loader size="lg" />
          </Center>
        )}

        {/* Section 2: 진행 상황 */}
        {initialSnapshot && (
          <Paper p="xl" radius="md" withBorder>
            <Text size="lg" fw={700} mb="md">
              📊 진행 상황
            </Text>

            <Stack gap="md">
              {/* 시간 정보 */}
              <SimpleGrid cols={3}>
                <div>
                  <Text size="xs" c="dimmed" mb={4}>
                    시작
                  </Text>
                  <Text size="sm" fw={500}>
                    {formatDateTime(monitor.started_at)}
                  </Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed" mb={4}>
                    현재
                  </Text>
                  <Text size="sm" fw={500}>
                    {currentTime ? formatDateTime(currentTime) : '로딩 중...'}
                    <Text size="xs" c="dimmed" span ml={4}>
                      ({elapsed} 경과)
                    </Text>
                  </Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed" mb={4}>
                    만료
                  </Text>
                  <Text size="sm" fw={500}>
                    {formatDateTime(monitor.expires_at)}
                    <Text size="xs" c="dimmed" span ml={4}>
                      ({remaining} 남음)
                    </Text>
                  </Text>
                </div>
              </SimpleGrid>

              {/* 진행률 */}
              <div>
                <Group justify="space-between" mb="xs">
                  <Text size="sm" fw={500}>
                    진행률
                  </Text>
                  <Text size="sm" fw={600} c="blue">
                    {progress}% ({daysElapsed}일 / {totalDays}일)
                  </Text>
                </Group>
                <Progress value={progress} size="lg" color="blue" animated={monitor.status === 'active'} />
              </div>

              {/* 다음 실행 */}
              {monitor.status === 'active' && !isPaused && (
                <Alert icon={<IconClock />} color="blue" variant="light">
                  <Text size="sm">
                    💡 다음 실행: <Text fw={600} span>{nextRunTime}</Text>
                  </Text>
                </Alert>
              )}
            </Stack>
          </Paper>
        )}

        {/* Section 3: 누적 현황 */}
        {initialSnapshot && (
          <Paper p="xl" radius="md" withBorder>
            <Text size="lg" fw={700} mb="md">
              📈 누적 현황
            </Text>

            <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }}>
              {/* 총 크래시 */}
              <Card withBorder padding="lg">
                <Stack gap="xs">
                  <Text size="xs" c="dimmed">
                    총 크래시
                  </Text>
                  <Text size="xl" fw={700}>
                    {formatNumber(initialSnapshot.cumulative.totalCrashes)}건
                  </Text>
                  <Badge
                    size="sm"
                    color={initialSnapshot.cumulative.totalCrashes < 100 ? 'green' : 'orange'}
                  >
                    {initialSnapshot.cumulative.totalCrashes < 100 ? '✅ 정상' : '⚠️ 주의'}
                  </Badge>
                </Stack>
              </Card>

              {/* 고유 이슈 */}
              <Card withBorder padding="lg">
                <Stack gap="xs">
                  <Text size="xs" c="dimmed">
                    고유 이슈
                  </Text>
                  <Text size="xl" fw={700}>
                    {formatNumber(initialSnapshot.cumulative.uniqueIssues)}개
                  </Text>
                  <Badge
                    size="sm"
                    color={initialSnapshot.cumulative.uniqueIssues < 10 ? 'green' : 'orange'}
                  >
                    {initialSnapshot.cumulative.uniqueIssues < 10 ? '✅ 정상' : '⚠️ 주의'}
                  </Badge>
                </Stack>
              </Card>

              {/* 영향 사용자 */}
              <Card withBorder padding="lg">
                <Stack gap="xs">
                  <Text size="xs" c="dimmed">
                    영향 사용자
                  </Text>
                  <Text size="xl" fw={700}>
                    {formatNumber(initialSnapshot.cumulative.affectedUsers)}명
                  </Text>
                  <Badge
                    size="sm"
                    color={initialSnapshot.cumulative.affectedUsers < 50 ? 'green' : 'orange'}
                  >
                    {initialSnapshot.cumulative.affectedUsers < 50 ? '✅ 정상' : '⚠️ 주의'}
                  </Badge>
                </Stack>
              </Card>

              {/* Crash Free Rate */}
              <Card withBorder padding="lg">
                <Stack gap="xs">
                  <Text size="xs" c="dimmed">
                    Crash Free Rate
                  </Text>
                  <Text size="xl" fw={700}>
                    {formatPercentage(initialSnapshot.cumulative.crashFreeRate)}
                  </Text>
                  <Badge
                    size="sm"
                    color={initialSnapshot.cumulative.crashFreeRate >= 99.5 ? 'green' : 'orange'}
                  >
                    {initialSnapshot.cumulative.crashFreeRate >= 99.5 ? '✅ 정상' : '⚠️ 주의'}
                  </Badge>
                </Stack>
              </Card>
            </SimpleGrid>

            {/* 최근 변화 */}
            {initialSnapshot.recentChange && (
              <Alert icon={<IconTrendingUp />} color="blue" variant="light" mt="md">
                <Text size="sm">📈 {initialSnapshot.recentChange.changeDescription}</Text>
              </Alert>
            )}
          </Paper>
        )}

        {/* Section 4: 시간별 추이 차트 */}
        {initialSnapshot && initialSnapshot.hourlyTrend.length > 0 && (
          <Paper p="xl" radius="md" withBorder>
            <Group justify="space-between" mb="md">
              <Text size="lg" fw={700}>
                📊 시간별 추이 (최근 24시간)
              </Text>
              <SegmentedControl
                value={chartMetric}
                onChange={(value: any) => setChartMetric(value)}
                data={[
                  { label: '크래시', value: 'crashes' },
                  { label: '이슈', value: 'issues' },
                  { label: '사용자', value: 'users' },
                  { label: 'CFR', value: 'cfr' }
                ]}
              />
            </Group>

            <LineChart
              h={300}
              data={getChartData()}
              dataKey="hour"
              series={[{ name: getMetricLabel(chartMetric), color: 'blue' }]}
              curveType="natural"
              gridAxis="xy"
              withLegend
              withTooltip
              tooltipAnimationDuration={200}
            />
          </Paper>
        )}

        {/* Section 5: 주요 이슈 목록 */}
        {initialSnapshot && initialSnapshot.topIssues.length > 0 && (
          <Paper p="xl" radius="md" withBorder>
            <Group justify="space-between" mb="md">
              <Text size="lg" fw={700}>
                🐛 주요 이슈 (Top 10)
              </Text>
              <Text size="sm" c="dimmed">
                총 {formatNumber(initialSnapshot.cumulative.uniqueIssues)}개 이슈
              </Text>
            </Group>

            <Stack gap="sm">
              {initialSnapshot.topIssues.slice(0, 10).map((issue, index) => (
                <Card key={issue.id} withBorder padding="md">
                  <Group justify="space-between" wrap="nowrap">
                    <div style={{ flex: 1 }}>
                      <Group gap="xs" mb="xs">
                        <Text size="sm" fw={600}>
                          {index + 1}. {issue.title}
                        </Text>
                        {issue.isNew && (
                          <Badge size="sm" color="cyan" variant="filled">
                            🆕 신규
                          </Badge>
                        )}
                        {issue.level === 'fatal' && (
                          <Badge size="sm" color="red" variant="filled">
                            ⚠️ Fatal
                          </Badge>
                        )}
                      </Group>
                      <Group gap="md">
                        <Text size="xs" c="dimmed">
                          💥 {formatNumber(issue.count)}건
                        </Text>
                        <Text size="xs" c="dimmed">
                          👥 영향 {formatNumber(issue.users)}명
                        </Text>
                        <Text size="xs" c="dimmed">
                          최초: {formatRelativeTime(issue.firstSeen)}
                        </Text>
                        <Text size="xs" c="dimmed">
                          최근: {formatRelativeTime(issue.lastSeen)}
                        </Text>
                      </Group>
                    </div>
                    <Button
                      size="xs"
                      variant="light"
                      component="a"
                      href={getSentryIssueUrl(monitor.platform, issue.id)}
                      target="_blank"
                      leftSection={<IconExternalLink size={14} />}
                    >
                      Sentry
                    </Button>
                  </Group>
                </Card>
              ))}
            </Stack>
          </Paper>
        )}

        {/* Section 6: 알림 히스토리 */}
        {initialHistory.length > 0 && (
          <Paper p="xl" radius="md" withBorder>
            <Group justify="space-between" mb="md">
              <Text size="lg" fw={700}>
                📝 실행 히스토리
              </Text>
              <Text size="sm" c="dimmed">
                총 {formatNumber(initialHistory.length)}건
              </Text>
            </Group>

            <Timeline active={-1} bulletSize={24} lineWidth={2}>
              {initialHistory.slice(0, 10).map((record) => {
                const severity =
                  record.events_count > 100
                    ? 'critical'
                    : record.events_count > 50
                    ? 'warning'
                    : 'normal';

                return (
                  <Timeline.Item
                    key={record.id}
                    bullet={
                      severity === 'normal' ? (
                        <IconCheck size={12} style={{ color: 'green' }} />
                      ) : severity === 'warning' ? (
                        <IconAlertTriangle size={12} style={{ color: 'orange' }} />
                      ) : (
                        <IconAlertCircle size={12} style={{ color: 'red' }} />
                      )
                    }
                    title={
                      <Group gap="xs">
                        <Text size="sm" fw={500}>
                          모니터링 실행
                        </Text>
                        <Badge size="sm" color={getSeverityColor(severity)}>
                          {getSeverityText(severity)}
                        </Badge>
                      </Group>
                    }
                  >
                    <Text size="xs" c="dimmed" mb={4}>
                      {formatDateTime(record.executed_at)}
                    </Text>
                    <Text size="sm" c="dimmed">
                      크래시: {formatNumber(record.events_count)}건 | 이슈:{' '}
                      {formatNumber(record.issues_count)}개 | 사용자:{' '}
                      {formatNumber(record.users_count)}명
                    </Text>
                    {record.slack_sent && (
                      <Text size="xs" c="green" mt={4}>
                        ✅ Slack 발송 완료
                      </Text>
                    )}
                  </Timeline.Item>
                );
              })}
            </Timeline>
          </Paper>
        )}
      </Stack>
    </Container>
  );
}
