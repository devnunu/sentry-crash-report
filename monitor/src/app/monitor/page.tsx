'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { formatKST, formatRelativeTime } from '@/lib/utils';
import type { MonitorSession, Platform, MonitorHistory } from '@/lib/types';
import { Button, Card, Checkbox, Group, NumberInput, Select, Stack, Table, Text, TextInput, Title, useMantineTheme } from '@mantine/core';
import StatusBadge from '@/components/StatusBadge'
import TableWrapper from '@/components/TableWrapper'
import StatsCards from '@/components/StatsCards'
import { notifications } from '@mantine/notifications'
import { useMediaQuery } from '@mantine/hooks'

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface MonitorWithHistory extends MonitorSession {
  lastHistory?: MonitorHistory;
}

interface StatusData {
  monitors: MonitorWithHistory[];
  total: number;
  active: number;
  stopped: number;
  expired: number;
}

// 상태별 스타일
const getStatusStyle = (status: string) => {
  switch (status) {
    case 'active':
      return { color: 'var(--ok)', backgroundColor: 'rgba(34, 197, 94, 0.1)' };
    case 'stopped':
      return { color: 'var(--danger)', backgroundColor: 'rgba(239, 68, 68, 0.1)' };
    case 'expired':
      return { color: 'var(--muted)', backgroundColor: 'rgba(154, 164, 178, 0.1)' };
    default:
      return { color: 'var(--muted)', backgroundColor: 'rgba(154, 164, 178, 0.1)' };
  }
};

const getStatusText = (status: string) => {
  switch (status) {
    case 'active': return '🟢 활성';
    case 'stopped': return '🔴 중단됨';
    case 'expired': return '⚫ 만료됨';
    default: return status;
  }
};

const getStatusBadge = (status: string): { color: string; label: string } => {
  switch (status) {
    case 'active':
      return { color: 'green', label: '활성' };
    case 'stopped':
      return { color: 'red', label: '중단됨' };
    case 'expired':
      return { color: 'gray', label: '만료됨' };
    default:
      return { color: 'gray', label: status };
  }
};


const thStyle: React.CSSProperties = {
  padding: '12px 14px',
  textAlign: 'left',
  fontWeight: 700,
  fontSize: '12px',
  letterSpacing: '0.2px',
  background: '#0f1524',
  color: 'var(--muted)',
  borderBottom: '1px solid var(--border)',
};

const tdStyle: React.CSSProperties = {
  padding: '12px 14px',
  fontSize: '13px',
  verticalAlign: 'middle',
  borderBottom: '1px solid var(--border)',
};

const tdMonoStyle: React.CSSProperties = {
  ...tdStyle,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  wordBreak: 'break-all',
};

export default function MonitorPage() {
  // 상태 관리
  const [monitors, setMonitors] = useState<MonitorWithHistory[]>([]);
  const [statusData, setStatusData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  
  // 새 모니터링 폼
  const [platform, setPlatform] = useState<Platform>('android');
  const [baseRelease, setBaseRelease] = useState('');
  const [days, setDays] = useState(7);
  const [isTestMode, setIsTestMode] = useState(false);
  const [startLoading, setStartLoading] = useState(false);
  const [startMessage, setStartMessage] = useState('');
  
  // 정지 중인 모니터 ID
  const [stoppingId, setStoppingId] = useState<string>('');

  // 상태 조회 함수
  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError('');
    
    try {
      const response = await fetch('/api/monitor/status', {
        cache: 'no-store'
      });
      
      const result: ApiResponse<StatusData> = await response.json();
      
      if (!result.success || !result.data) {
        throw new Error(result.error || '상태 조회에 실패했습니다');
      }
      
      setMonitors(result.data.monitors);
      setStatusData(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다');
    } finally {
      setLoading(false);
    }
  }, []);

  // 컴포넌트 마운트 시 상태 조회
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // 모니터링 시작
  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!baseRelease.trim()) {
      setStartMessage('❌ 베이스 릴리즈를 입력해주세요');
      return;
    }
    
    setStartLoading(true);
    setStartMessage('');
    
    try {
      const response = await fetch('/api/monitor/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, baseRelease: baseRelease.trim(), days, isTestMode })
      });
      
      const result: ApiResponse<{ message: string; monitorId: string }> = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || '모니터링 시작에 실패했습니다');
      }
      
      const msg = result.data?.message || '모니터링 시작됨';
      setStartMessage(`✅ ${msg}`);
      notifications.show({ color: 'green', message: `모니터 시작: ${msg}` });
      setBaseRelease(''); // 폼 리셋
      
      // 상태 새로고침
      setTimeout(() => {
        fetchStatus();
        setStartMessage('');
      }, 2000);
      
    } catch (err) {
      const m = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다';
      setStartMessage(`❌ ${m}`);
      notifications.show({ color: 'red', message: `모니터 시작 실패: ${m}` });
    } finally {
      setStartLoading(false);
    }
  };

  // 모니터링 정지
  const handleStop = async (monitorId: string) => {
    if (stoppingId === monitorId) return;
    
    setStoppingId(monitorId);
    
    try {
      const response = await fetch('/api/monitor/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monitorId })
      });
      
      const result: ApiResponse<{ message: string; monitorId: string }> = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || '모니터링 정지에 실패했습니다');
      }
      
      // UI에서 즉시 제거하고 새로고침
      setMonitors(prev => prev.filter(m => m.id !== monitorId));
      notifications.show({ color: 'green', message: '모니터 정지 완료' });
      setTimeout(fetchStatus, 1000);
      
    } catch (err) {
      const m = err instanceof Error ? err.message : '알 수 없는 오류';
      notifications.show({ color: 'red', message: `정지 실패: ${m}` });
    } finally {
      setStoppingId('');
    }
  };

  // 최신 정렬된 모니터 목록
  const sortedMonitors = [...monitors].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <div className="container">
      <Group justify="space-between" align="flex-start" mb="sm">
        <div>
          <Title order={2}>🚀 Sentry 릴리즈 모니터링</Title>
          <Text c="dimmed" size="sm">
            특정 릴리즈 버전의 error/fatal 이슈를 7일간 자동으로 모니터링합니다. 첫 24시간은 30분 간격, 이후는 1시간 간격으로 리포트를 제공합니다.
          </Text>
        </div>
      </Group>

      {/* 새 모니터링 시작 카드 */}
      <Card withBorder radius="lg" p="lg" mt="md">
        <Title order={4} mb="sm">▶️ 새 모니터링 시작</Title>
        <form onSubmit={handleStart}>
          <Stack gap="xs">
            <Group wrap="wrap" gap="sm" align="flex-end">
              <Select
                label="플랫폼"
                data={[{ value: 'android', label: 'Android' }, { value: 'ios', label: 'iOS' }]}
                value={platform}
                onChange={(val) => setPlatform((val as Platform) ?? 'android')}
                allowDeselect={false}
                w={220}
              />
              <TextInput
                label="베이스 릴리즈"
                value={baseRelease}
                onChange={(e) => setBaseRelease(e.currentTarget.value)}
                placeholder="예: 4.69.0"
                required
                w={260}
              />
              <NumberInput
                label="기간(일)"
                value={days}
                min={1}
                max={14}
                onChange={(v) => setDays(Number(v) || 7)}
                w={120}
              />
              <Checkbox
                label="🧪 테스트 모드 (테스트용 Slack 채널로 알림 전송)"
                checked={isTestMode}
                onChange={(e) => setIsTestMode(e.currentTarget.checked)}
              />
              <Button type="submit" loading={startLoading} color="green">
                모니터링 시작
              </Button>
            </Group>
            {startMessage && (
              <Text size="sm" c="dimmed">{startMessage}</Text>
            )}
          </Stack>
        </form>
      </Card>

      {/* 현재 상태 카드 */}
      <Card withBorder radius="lg" p="lg" mt="md">
        <Group justify="space-between" align="center">
          <Title order={4}>📊 현재 모니터링 상태</Title>
          <Button variant="light" onClick={fetchStatus} loading={loading}>새로고침</Button>
        </Group>

        {statusData && (
          <StatsCards
            items={[
              { label: '전체', value: statusData.total },
              { label: '활성', value: statusData.active, color: 'green' },
              { label: '중단됨', value: statusData.stopped, color: 'red' },
              { label: '만료됨', value: statusData.expired, color: 'dimmed' },
            ]}
          />
        )}

        {error && (
          <div className="muted" style={{ color: 'var(--danger)' }}>⚠️ {error}</div>
        )}

        {/* 모니터 목록 */}
        {sortedMonitors.length === 0 ? (
          <div className="muted" style={{ textAlign: 'center', padding: '40px 0' }}>
            {loading ? '로딩 중...' : '모니터가 없습니다.'}
          </div>
        ) :
          // 반응형: 데스크톱 테이블 vs 모바일 카드
          isMobile ? (
            <div className="mobile-cards" style={{ marginTop: 16 }}>
              {sortedMonitors.map((monitor) => (
                <Card key={monitor.id} withBorder radius="md" p="md" style={{ marginBottom: 12 }}>
                  <Group justify="space-between" align="center" mb={8}>
                    <StatusBadge kind="monitor" status={monitor.status} />
                    {monitor.status === 'active' && (
                      <Button color="red" size="xs" onClick={() => handleStop(monitor.id)} loading={stoppingId === monitor.id}>
                        {stoppingId === monitor.id ? '정지 중...' : '정지'}
                      </Button>
                    )}
                  </Group>
                  <Stack gap={6}>
                    <Text size="xs" c="dimmed">플랫폼</Text>
                    <Text size="sm">{monitor.platform.toUpperCase()}</Text>
                    <Text size="xs" c="dimmed">베이스 릴리즈</Text>
                    <Text size="sm" className="mono">{monitor.base_release}</Text>
                    <Text size="xs" c="dimmed">매칭 릴리즈</Text>
                    <Text size="sm" className="mono">{monitor.matched_release || '-'}</Text>
                    <Text size="xs" c="dimmed">시작일</Text>
                    <Text size="sm">{formatKST(monitor.started_at)}</Text>
                    <Text size="xs" c="dimmed">만료일</Text>
                    <Text size="sm">{formatKST(monitor.expires_at)}</Text>
                    <Text size="xs" c="dimmed">남은 기간</Text>
                    <Text size="sm">{formatRelativeTime(monitor.expires_at)}</Text>
                    <Text size="xs" c="dimmed">최근 실행</Text>
                    {monitor.lastHistory ? (
                      <div>
                        <Text size="sm">{formatKST(monitor.lastHistory.executed_at)}</Text>
                        <Text size="xs" c="dimmed">E:{monitor.lastHistory.events_count} | I:{monitor.lastHistory.issues_count} | U:{monitor.lastHistory.users_count}</Text>
                      </div>
                    ) : (
                      <Text size="sm" c="dimmed">아직 실행 없음</Text>
                    )}
                  </Stack>
                </Card>
              ))}
            </div>
          ) : (
            <TableWrapper>
              <Table highlightOnHover withColumnBorders verticalSpacing="xs" stickyHeader stickyHeaderOffset={0}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>상태</Table.Th>
                    <Table.Th>플랫폼</Table.Th>
                    <Table.Th>베이스 릴리즈</Table.Th>
                    <Table.Th>매칭 릴리즈</Table.Th>
                    <Table.Th>시작일(KST)</Table.Th>
                    <Table.Th>만료일(KST)</Table.Th>
                    <Table.Th>남은 기간</Table.Th>
                    <Table.Th>최근 실행</Table.Th>
                    <Table.Th style={{ textAlign: 'right' }}>액션</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {sortedMonitors.map((monitor) => {
                    return (
                      <Table.Tr key={monitor.id}>
                        <Table.Td>
                          <StatusBadge kind="monitor" status={monitor.status} />
                        </Table.Td>
                        <Table.Td>{monitor.platform.toUpperCase()}</Table.Td>
                        <Table.Td className="mono">{monitor.base_release}</Table.Td>
                        <Table.Td className="mono">{monitor.matched_release || '-'}</Table.Td>
                        <Table.Td>{formatKST(monitor.started_at)}</Table.Td>
                        <Table.Td>{formatKST(monitor.expires_at)}</Table.Td>
                        <Table.Td>{formatRelativeTime(monitor.expires_at)}</Table.Td>
                        <Table.Td>
                          {monitor.lastHistory ? (
                            <div>
                              <div style={{ marginBottom: 4 }}>{formatKST(monitor.lastHistory.executed_at)}</div>
                              <Text size="xs" c="dimmed">
                                E:{monitor.lastHistory.events_count} | I:{monitor.lastHistory.issues_count} | U:{monitor.lastHistory.users_count}
                              </Text>
                            </div>
                          ) : (
                            <Text c="dimmed">아직 실행 없음</Text>
                          )}
                        </Table.Td>
                        <Table.Td style={{ textAlign: 'right' }}>
                          {monitor.status === 'active' && (
                            <Button
                              onClick={() => handleStop(monitor.id)}
                              loading={stoppingId === monitor.id}
                              color="red"
                              size="xs"
                              variant="filled"
                              title="이 모니터를 중단합니다"
                            >
                              정지
                            </Button>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </TableWrapper>
        )}
      </Card>

      {/* 도움말 */}
      <div className="muted" style={{ marginTop: '20px', fontSize: '12px' }}>
        💡 <strong>참고:</strong> 모니터링은 Vercel Cron을 통해 자동 실행되며,
        level:[error,fatal] 이벤트만 수집합니다.
        실행 결과는 설정된 Slack 채널로 전송됩니다.
      </div>
    </div>
  );
}
