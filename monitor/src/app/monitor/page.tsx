'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { formatKST, formatRelativeTime } from '@/lib/utils';
import type { MonitorSession, Platform, MonitorHistory } from '@/lib/types';
import {
  Badge,
  Button,
  Card,
  Container,
  Divider,
  Group,
  Modal,
  NumberInput,
  Paper,
  Progress,
  Select,
  Stack,
  Text,
  TextInput,
  Title
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconChartBar,
  IconDashboard,
  IconHistory,
  IconPlayerPause,
  IconPlus,
  IconRadar,
  IconTrash
} from '@tabler/icons-react';
import ReleaseSearchModal from '@/components/ReleaseSearchModal';

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

// ========== 헬퍼 함수 ==========

function getStatusEmoji(status: string): string {
  const map: Record<string, string> = {
    'active': '✅',
    'stopped': '🔴',
    'expired': '⏱️'
  };
  return map[status] || '📊';
}

function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    'active': 'green',
    'stopped': 'red',
    'expired': 'gray'
  };
  return map[status] || 'blue';
}

function getStatusText(status: string): string {
  const map: Record<string, string> = {
    'active': '진행 중',
    'stopped': '중단됨',
    'expired': '만료됨'
  };
  return map[status] || status;
}

function getProgress(monitor: MonitorWithHistory): number {
  const start = new Date(monitor.started_at).getTime();
  const end = new Date(monitor.expires_at).getTime();
  const now = Date.now();

  const total = end - start;
  const elapsed = now - start;

  return Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
}

function getDaysLeft(expiresAt: string): number {
  const now = new Date();
  const end = new Date(expiresAt);
  const diff = end.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

function formatDateRange(start: string, end: string): string {
  return `${formatDate(start)} ~ ${formatDate(end)}`;
}

function getNextReportTime(monitor: MonitorWithHistory): string {
  if (!monitor.lastHistory) return '첫 리포트 대기 중';

  const lastExec = new Date(monitor.lastHistory.executed_at);
  const interval = monitor.custom_interval_minutes || 60;
  const nextExec = new Date(lastExec.getTime() + interval * 60 * 1000);

  const now = new Date();
  const diffMin = Math.round((nextExec.getTime() - now.getTime()) / (1000 * 60));

  if (diffMin <= 0) return '곧 실행 예정';
  if (diffMin < 60) return `약 ${diffMin}분 후`;

  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  return `약 ${hours}시간 ${mins}분 후`;
}

function getResultEmoji(result?: string): string {
  if (!result) return '✅';

  const map: Record<string, string> = {
    'success': '✅',
    'normal': '✅',
    'warning': '⚠️',
    'critical': '🚨'
  };
  return map[result] || '✅';
}

// ========== 메인 컴포넌트 ==========

export default function MonitorPage() {
  // 상태 관리
  const [monitors, setMonitors] = useState<MonitorWithHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  // 모달 관리
  const [newMonitorModalOpened, setNewMonitorModalOpened] = useState(false);
  const [isReleaseSearchModalOpen, setIsReleaseSearchModalOpen] = useState(false);

  // 새 모니터링 폼
  const [platform, setPlatform] = useState<Platform>('android');
  const [baseRelease, setBaseRelease] = useState('');
  const [matchedRelease, setMatchedRelease] = useState('');
  const [days, setDays] = useState(7);
  const [startLoading, setStartLoading] = useState(false);

  // 액션 로딩
  const [actionLoading, setActionLoading] = useState<string>('');

  useEffect(() => {
    setMatchedRelease('');
  }, [platform]);

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
      notifications.show({ color: 'red', message: '베이스 릴리즈를 입력해주세요' });
      return;
    }

    if (!matchedRelease) {
      notifications.show({ color: 'red', message: '릴리즈 검색 후 실제 릴리즈를 선택해주세요' });
      return;
    }

    setStartLoading(true);

    try {
      const response = await fetch('/api/monitor/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          baseRelease: baseRelease.trim(),
          matchedRelease,
          days,
          isTestMode: false
        })
      });

      const result: ApiResponse<{ message: string; monitorId: string }> = await response.json();

      if (!result.success) {
        throw new Error(result.error || '모니터링 시작에 실패했습니다');
      }

      const msg = result.data?.message || '모니터링 시작됨';
      notifications.show({ color: 'green', message: `모니터 시작: ${msg}` });

      // 폼 리셋
      setBaseRelease('');
      setMatchedRelease('');
      setNewMonitorModalOpened(false);

      // 상태 새로고침
      setTimeout(() => {
        fetchStatus();
      }, 1000);

    } catch (err) {
      const m = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다';
      notifications.show({ color: 'red', message: `모니터 시작 실패: ${m}` });
    } finally {
      setStartLoading(false);
    }
  };

  // 모니터링 일시정지
  const handlePause = async (monitorId: string) => {
    if (actionLoading === monitorId) return;

    setActionLoading(monitorId);

    try {
      // TODO: 일시정지 API 구현 필요
      notifications.show({ color: 'blue', message: '일시정지 기능은 곧 추가됩니다' });
    } catch (err) {
      const m = err instanceof Error ? err.message : '알 수 없는 오류';
      notifications.show({ color: 'red', message: `일시정지 실패: ${m}` });
    } finally {
      setActionLoading('');
    }
  };

  // 모니터링 중단
  const handleStop = async (monitorId: string) => {
    if (actionLoading === monitorId) return;

    setActionLoading(monitorId);

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

      notifications.show({ color: 'green', message: '모니터 정지 완료' });
      setTimeout(fetchStatus, 1000);

    } catch (err) {
      const m = err instanceof Error ? err.message : '알 수 없는 오류';
      notifications.show({ color: 'red', message: `정지 실패: ${m}` });
    } finally {
      setActionLoading('');
    }
  };

  // 모니터 분류
  const activeMonitors = monitors
    .filter(m => m.status === 'active')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const completedMonitors = monitors
    .filter(m => m.status === 'stopped' || m.status === 'expired')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <Container size="xl" py="xl">
      <Stack gap="xl">
        {/* ========== Section 1: 헤더 + 새 모니터링 버튼 ========== */}
        <div>
          <Title order={2}>🚀 버전별 모니터링</Title>
          <Text c="dimmed" size="sm">
            새 버전 배포 후 7일간 자동 모니터링
          </Text>
        </div>

        <Button
          size="lg"
          leftSection={<IconPlus size={20} />}
          onClick={() => setNewMonitorModalOpened(true)}
        >
          새 모니터링 시작
        </Button>

        <Divider />

        {/* ========== Section 2: 진행 중인 모니터링 ========== */}
        <Paper p="xl" radius="md" withBorder>
          <Group mb="md">
            <IconRadar size={24} />
            <Text size="lg" fw={700}>
              📡 진행 중인 모니터링 ({activeMonitors.length}개)
            </Text>
          </Group>

          {activeMonitors.length === 0 ? (
            <Text c="dimmed" ta="center" py="xl">
              현재 진행 중인 모니터링이 없습니다.
              <br />
              새 버전을 배포했다면 모니터링을 시작하세요.
            </Text>
          ) : (
            <Stack gap="md">
              {activeMonitors.map(monitor => (
                <Card key={monitor.id} padding="lg" withBorder>
                  <Stack gap="md">
                    {/* 헤더 */}
                    <Group justify="space-between">
                      <Text size="lg" fw={600}>
                        {getStatusEmoji(monitor.status)} {monitor.platform.toUpperCase()} {monitor.matched_release || monitor.base_release}
                      </Text>
                      <Badge color={getStatusColor(monitor.status)} size="lg">
                        {getStatusText(monitor.status)}
                      </Badge>
                    </Group>

                    {/* 진행 상황 */}
                    <div>
                      <Text size="sm" fw={600} mb={4}>🗓️ 진행 상황</Text>
                      <Stack gap="xs">
                        <Text size="sm" c="dimmed">
                          • 시작: {formatKST(monitor.started_at)}
                        </Text>
                        <Text size="sm" c="dimmed">
                          • 만료: {formatKST(monitor.expires_at)} ({getDaysLeft(monitor.expires_at)}일 남음)
                        </Text>
                        <Group gap="xs">
                          <Text size="sm" c="dimmed">• 진행률:</Text>
                          <Progress
                            value={getProgress(monitor)}
                            style={{ flex: 1 }}
                            color={getProgress(monitor) > 80 ? 'orange' : 'blue'}
                          />
                          <Text size="sm" fw={500}>
                            {getProgress(monitor)}%
                          </Text>
                        </Group>
                      </Stack>
                    </div>

                    {/* 현재 상태 */}
                    <div>
                      <Text size="sm" fw={600} mb={4}>📊 현재 상태</Text>
                      <Stack gap="xs">
                        {monitor.lastHistory ? (
                          <>
                            <Text size="sm">
                              • 총 크래시: {monitor.lastHistory.events_count.toLocaleString()}건
                            </Text>
                            <Text size="sm">
                              • 영향 사용자: {monitor.lastHistory.users_count.toLocaleString()}명
                            </Text>
                            <Text size="sm">
                              • 이슈 개수: {monitor.lastHistory.issues_count}개
                            </Text>
                          </>
                        ) : (
                          <Text size="sm" c="dimmed">
                            • 첫 리포트 대기 중
                          </Text>
                        )}
                      </Stack>
                    </div>

                    {/* 다음 리포트 */}
                    <Text size="sm" c="dimmed">
                      💡 다음 리포트: {getNextReportTime(monitor)}
                    </Text>

                    {/* 액션 버튼 */}
                    <Group gap="xs">
                      <Button
                        size="sm"
                        variant="filled"
                        leftSection={<IconDashboard size={16} />}
                        disabled
                      >
                        실시간 대시보드
                      </Button>
                      <Button
                        size="sm"
                        variant="light"
                        leftSection={<IconPlayerPause size={16} />}
                        onClick={() => handlePause(monitor.id)}
                        loading={actionLoading === monitor.id}
                        disabled
                      >
                        일시정지
                      </Button>
                      <Button
                        size="sm"
                        variant="subtle"
                        color="red"
                        leftSection={<IconTrash size={16} />}
                        onClick={() => handleStop(monitor.id)}
                        loading={actionLoading === monitor.id}
                      >
                        중단
                      </Button>
                    </Group>
                  </Stack>
                </Card>
              ))}
            </Stack>
          )}
        </Paper>

        {/* ========== Section 3: 최근 모니터링 히스토리 ========== */}
        <Paper p="xl" radius="md" withBorder>
          <Group mb="md">
            <IconHistory size={24} />
            <Text size="lg" fw={700}>
              📜 최근 모니터링 히스토리 ({completedMonitors.length}개)
            </Text>
          </Group>

          {completedMonitors.length === 0 ? (
            <Text c="dimmed" ta="center" py="xl">
              아직 완료된 모니터링이 없습니다.
            </Text>
          ) : (
            <Stack gap="md">
              {completedMonitors.slice(0, 5).map(monitor => (
                <Card key={monitor.id} padding="md" withBorder>
                  <Group justify="space-between">
                    <div style={{ flex: 1 }}>
                      <Group gap="xs" mb="xs">
                        <Text fw={600}>
                          {getResultEmoji(monitor.status)} {monitor.platform.toUpperCase()} {monitor.matched_release || monitor.base_release}
                        </Text>
                        <Badge size="sm" color={getStatusColor(monitor.status)}>
                          {getStatusText(monitor.status)}
                        </Badge>
                      </Group>
                      <Text size="sm" c="dimmed">
                        {formatDateRange(monitor.started_at, monitor.expires_at)}
                      </Text>
                      {monitor.lastHistory && (
                        <Text size="sm" mt="xs">
                          결과: 크래시 {monitor.lastHistory.events_count.toLocaleString()}건,
                          사용자 {monitor.lastHistory.users_count.toLocaleString()}명 영향
                        </Text>
                      )}
                    </div>

                    <Button
                      size="sm"
                      variant="light"
                      leftSection={<IconChartBar size={16} />}
                      disabled
                    >
                      상세 보기
                    </Button>
                  </Group>
                </Card>
              ))}

              {completedMonitors.length > 5 && (
                <Button variant="subtle" fullWidth>
                  더보기... ({completedMonitors.length - 5}개 더)
                </Button>
              )}
            </Stack>
          )}
        </Paper>

        {/* 도움말 */}
        <Text size="xs" c="dimmed">
          💡 <strong>참고:</strong> 모니터링은 Vercel Cron을 통해 자동 실행되며,
          level:[error,fatal] 이벤트만 수집합니다.
          실행 결과는 설정된 Slack 채널로 전송됩니다.
        </Text>
      </Stack>

      {/* ========== 새 모니터링 시작 모달 ========== */}
      <Modal
        opened={newMonitorModalOpened}
        onClose={() => setNewMonitorModalOpened(false)}
        title={<Text fw={700} size="lg">새 모니터링 시작</Text>}
        size="lg"
      >
        <form onSubmit={handleStart}>
          <Stack gap="lg">
            <Select
              label="플랫폼"
              description="모니터링할 플랫폼을 선택하세요"
              data={[
                { value: 'android', label: '🤖 Android' },
                { value: 'ios', label: '🍎 iOS' }
              ]}
              value={platform}
              onChange={(val) => setPlatform((val as Platform) ?? 'android')}
              allowDeselect={false}
              size="md"
              required
            />

            <TextInput
              label="베이스 릴리즈"
              description="릴리즈 검색 버튼을 통해 실제 버전을 선택하세요"
              value={matchedRelease ? `${baseRelease} → ${matchedRelease}` : baseRelease}
              placeholder="예: 4.70.0"
              readOnly
              onClick={() => setIsReleaseSearchModalOpen(true)}
              size="md"
              required
              rightSection={
                <Button
                  size="xs"
                  variant="light"
                  onClick={() => setIsReleaseSearchModalOpen(true)}
                >
                  검색
                </Button>
              }
              rightSectionWidth={80}
              styles={{ input: { cursor: 'pointer' } }}
            />

            <NumberInput
              label="모니터링 기간"
              description="모니터링할 일수 (최대 14일)"
              value={days}
              min={1}
              max={14}
              onChange={(v) => setDays(Number(v) || 7)}
              size="md"
              suffix="일"
            />

            <Group justify="flex-end" gap="sm">
              <Button
                variant="subtle"
                onClick={() => setNewMonitorModalOpened(false)}
              >
                취소
              </Button>
              <Button
                type="submit"
                loading={startLoading}
                disabled={startLoading || !matchedRelease}
              >
                {startLoading ? '시작 중...' : '모니터링 시작'}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* ========== 릴리즈 검색 모달 ========== */}
      <ReleaseSearchModal
        opened={isReleaseSearchModalOpen}
        onClose={() => setIsReleaseSearchModalOpen(false)}
        platform={platform}
        baseRelease={baseRelease}
        onApply={(base, matched) => {
          setBaseRelease(base);
          setMatchedRelease(matched);
          setIsReleaseSearchModalOpen(false);
        }}
      />
    </Container>
  );
}
