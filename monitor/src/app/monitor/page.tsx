'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { formatKST, formatRelativeTime } from '@/lib/utils';
import type { MonitorSession, Platform, MonitorHistory } from '@/lib/types';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Checkbox,
  Container,
  Divider,
  Group,
  Modal,
  Pagination,
  Paper,
  Progress,
  Radio,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  Timeline,
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
  IconSearch,
  IconTrash
} from '@tabler/icons-react';

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

interface Release {
  version: string;
  dateReleased?: string;
  dateCreated?: string;
  environments?: string[];
  projectMatched?: boolean;
  environmentMatched?: boolean;
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

// 베이스 버전 추출 - API 전송용 (4.72.0.0+546 → 4.72.0)
function getBaseVersionForAPI(version: string): string {
  const withoutBuildNumber = version.split('+')[0].split('-')[0];
  const parts = withoutBuildNumber.split('.');
  // 처음 3개 부분만 추출 (x.y.z 형식)
  return parts.slice(0, 3).join('.');
}

// 전체 버전 (빌드 번호 제외) - 중복 제거용 (4.72.0.0+546 → 4.72.0.0)
function getVersionWithoutBuild(version: string): string {
  return version.split('+')[0].split('-')[0];
}

// 버전 코드 추출 (4.72.0+920 → 920)
function getVersionCode(version: string): number {
  const parts = version.split('+');
  if (parts.length > 1) {
    const code = parseInt(parts[1]);
    return isNaN(code) ? 0 : code;
  }
  return 0;
}

// 상대 시간 표시
function getRelativeTime(dateStr: string): string {
  const now = new Date();
  const target = new Date(dateStr);
  const diffMs = now.getTime() - target.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return '오늘';
  if (diffDays === 1) return '어제';
  if (diffDays < 7) return `${diffDays}일 전`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}주 전`;
  return `${Math.floor(diffDays / 30)}개월 전`;
}

// 중복 제거 (같은 버전 + 빌드 번호 다른 것만 중복 처리)
// 예: 4.72.0+912와 4.72.0+920 → 920만 남음
// 예: 4.72.0+912와 4.72.0.0+546 → 둘 다 유지 (다른 버전)
function deduplicateReleases(releases: Release[]): Release[] {
  const versionMap = new Map<string, Release>();

  releases.forEach(release => {
    // 빌드 번호를 제외한 전체 버전을 키로 사용 (4.72.0.0+546 → 4.72.0.0)
    const versionKey = getVersionWithoutBuild(release.version);
    const existing = versionMap.get(versionKey);

    if (!existing) {
      versionMap.set(versionKey, release);
      return;
    }

    // 버전 코드 비교 (+ 뒤의 숫자)
    const releaseCode = getVersionCode(release.version);
    const existingCode = getVersionCode(existing.version);

    // 버전 코드가 다르면 버전 코드로 비교
    if (releaseCode !== existingCode) {
      if (releaseCode > existingCode) {
        versionMap.set(versionKey, release);
      }
      return;
    }

    // 버전 코드가 같으면 날짜로 비교
    const releaseDate = new Date(release.dateReleased || release.dateCreated || 0);
    const existingDate = new Date(existing.dateReleased || existing.dateCreated || 0);

    if (releaseDate > existingDate) {
      versionMap.set(versionKey, release);
    }
  });

  return Array.from(versionMap.values());
}

// 날짜 포맷
function formatDateTime(dateStr?: string): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// ========== 메인 컴포넌트 ==========

export default function MonitorPage() {
  // 상태 관리
  const [monitors, setMonitors] = useState<MonitorWithHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  // 페이지네이션
  const [historyPage, setHistoryPage] = useState(1);
  const HISTORY_PER_PAGE = 5;

  // 모달 관리
  const [newMonitorModalOpened, setNewMonitorModalOpened] = useState(false);

  // 새 모니터링 폼
  const [platform, setPlatform] = useState<Platform>('android');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRelease, setSelectedRelease] = useState('');
  const [duration, setDuration] = useState('1');
  const [startLoading, setStartLoading] = useState(false);

  // 릴리즈 관련
  const [allReleases, setAllReleases] = useState<Release[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // 액션 로딩
  const [actionLoading, setActionLoading] = useState<string>('');

  // 히스토리 모달 상태
  const [historyModalOpened, setHistoryModalOpened] = useState(false);
  const [selectedMonitorId, setSelectedMonitorId] = useState<string | null>(null);
  const [monitorHistories, setMonitorHistories] = useState<MonitorHistory[]>([]);
  const [isLoadingHistories, setIsLoadingHistories] = useState(false);

  // 플랫폼 변경 시 초기화
  useEffect(() => {
    setSearchQuery('');
    setSelectedRelease('');
    setAllReleases([]);
  }, [platform]);

  // 검색어에 따라 릴리즈 검색
  const searchReleases = async () => {
    if (!searchQuery.trim()) {
      notifications.show({ color: 'orange', message: '검색어를 입력해주세요' });
      return;
    }

    setIsRefreshing(true);

    try {
      const params = new URLSearchParams({
        platform,
        baseRelease: searchQuery.trim()
      });

      const response = await fetch(`/api/monitor/releases?${params.toString()}`);
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || '릴리즈 검색에 실패했습니다');
      }

      const releases = result.data?.releases || [];
      setAllReleases(releases);

      if (releases.length === 0) {
        notifications.show({ color: 'orange', message: '검색 결과가 없습니다' });
      }

    } catch (err) {
      const m = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다';
      notifications.show({ color: 'red', message: `릴리즈 검색 실패: ${m}` });
    } finally {
      setIsRefreshing(false);
    }
  };

  // 필터링된 릴리즈 (중복 제거, 정렬)
  const filteredReleases = useMemo(() => {
    let releases = [...allReleases];

    // 검색어 필터링
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      releases = releases.filter(r =>
        r.version.toLowerCase().includes(query)
      );
    }

    // 중복 제거 (버전 코드가 높은 것을 최신으로)
    releases = deduplicateReleases(releases);

    // 최신순 정렬 (날짜 우선, 버전 코드는 부차적)
    releases.sort((a, b) => {
      // 먼저 날짜로 비교
      const dateA = new Date(a.dateReleased || a.dateCreated || 0);
      const dateB = new Date(b.dateReleased || b.dateCreated || 0);

      if (dateA.getTime() !== dateB.getTime()) {
        return dateB.getTime() - dateA.getTime();
      }

      // 날짜가 같으면 버전 코드로 비교
      const codeA = getVersionCode(a.version);
      const codeB = getVersionCode(b.version);
      return codeB - codeA;
    });

    // 최대 10개만 표시
    return releases.slice(0, 10);
  }, [allReleases, searchQuery]);

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

    if (!selectedRelease) {
      notifications.show({ color: 'red', message: '릴리즈를 선택해주세요' });
      return;
    }

    setStartLoading(true);

    try {
      const baseVersion = getBaseVersionForAPI(selectedRelease);

      const response = await fetch('/api/monitor/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          baseRelease: baseVersion,
          matchedRelease: selectedRelease,
          days: parseInt(duration),
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
      setSearchQuery('');
      setSelectedRelease('');
      setAllReleases([]);
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

  // 히스토리 모달 열기
  const openHistoryModal = async (monitorId: string) => {
    setSelectedMonitorId(monitorId);
    setHistoryModalOpened(true);
    await loadHistories(monitorId);
  };

  // 히스토리 로드
  const loadHistories = async (monitorId: string) => {
    setIsLoadingHistories(true);
    try {
      const response = await fetch(`/api/monitor/${monitorId}/history`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || '히스토리 조회에 실패했습니다');
      }

      setMonitorHistories(result.data?.histories || []);
    } catch (err) {
      notifications.show({
        color: 'red',
        message: err instanceof Error ? err.message : '히스토리 조회 실패'
      });
      setMonitorHistories([]);
    } finally {
      setIsLoadingHistories(false);
    }
  };

  // 모니터 분류
  const activeMonitors = monitors
    .filter(m => m.status === 'active')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const completedMonitors = monitors
    .filter(m => m.status === 'stopped' || m.status === 'expired')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // 페이지네이션된 히스토리
  const totalHistoryPages = Math.ceil(completedMonitors.length / HISTORY_PER_PAGE);
  const paginatedHistory = completedMonitors.slice(
    (historyPage - 1) * HISTORY_PER_PAGE,
    historyPage * HISTORY_PER_PAGE
  );

  return (
    <Container size="xl" py="xl">
      <Stack gap="xl">
        {/* ========== Section 1: 헤더 + 새 모니터링 버튼 ========== */}
        <div>
          <Title order={2}>🚀 버전별 모니터링</Title>
          <Text c="dimmed" size="sm">
            새 버전 배포 후 1~3일간 자동 모니터링
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
              진행 중인 모니터링 ({activeMonitors.length}개)
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
                      <Group gap="xs">
                        <Text size="lg" fw={600}>
                          {getStatusEmoji(monitor.status)} {monitor.platform.toUpperCase()} {monitor.matched_release || monitor.base_release}
                        </Text>
                        {monitor.is_test_mode && (
                          <Badge color="violet" variant="light" size="sm">
                            테스트
                          </Badge>
                        )}
                      </Group>
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
                        {monitor.custom_interval_minutes && (
                          <Text size="sm" c="dimmed">
                            • 실행 간격: {monitor.custom_interval_minutes}분마다
                          </Text>
                        )}
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
                        variant="light"
                        leftSection={<IconChartBar size={16} />}
                        onClick={() => openHistoryModal(monitor.id)}
                      >
                        상세 보기
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
               최근 모니터링 히스토리 ({completedMonitors.length}개)
            </Text>
          </Group>

          {completedMonitors.length === 0 ? (
            <Text c="dimmed" ta="center" py="xl">
              아직 완료된 모니터링이 없습니다.
            </Text>
          ) : (
            <Stack gap="md">
              {paginatedHistory.map(monitor => (
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
                        {monitor.is_test_mode && (
                          <Badge size="sm" color="violet" variant="light">
                            테스트
                          </Badge>
                        )}
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
                      onClick={() => openHistoryModal(monitor.id)}
                    >
                      상세 보기
                    </Button>
                  </Group>
                </Card>
              ))}

              {totalHistoryPages > 1 && (
                <Group justify="center" mt="md">
                  <Pagination
                    total={totalHistoryPages}
                    value={historyPage}
                    onChange={setHistoryPage}
                    size="md"
                  />
                </Group>
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

      {/* ========== 새 모니터링 시작 모달 (단일 모달) ========== */}
      <Modal
        opened={newMonitorModalOpened}
        onClose={() => setNewMonitorModalOpened(false)}
        title={<Text fw={700} size="lg">새 모니터링 시작</Text>}
        size="lg"
      >
        <form onSubmit={handleStart}>
          <Stack gap="md">
            {/* 플랫폼 선택 */}
            <Select
              label="플랫폼"
              data={[
                { value: 'android', label: 'Android' },
                { value: 'ios', label: 'iOS' }
              ]}
              value={platform}
              onChange={(val) => setPlatform((val as Platform) ?? 'android')}
              allowDeselect={false}
              required
            />

            <Divider />

            {/* 베이스 릴리즈 선택 */}
            <div>
              <Text size="sm" fw={500} mb={4}>베이스 릴리즈</Text>
              <Text size="xs" c="dimmed" mb="md">
                모든 릴리즈 표시 (같은 버전은 버전 코드가 높은 것만 표시)
              </Text>

              {/* 검색창 */}
              <Group mb="md">
                <TextInput
                  placeholder="버전 검색... (예: 4.72.0)"
                  leftSection={<IconSearch size={16} />}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      searchReleases();
                    }
                  }}
                  style={{ flex: 1 }}
                />
                <ActionIcon
                  variant="light"
                  onClick={searchReleases}
                  loading={isRefreshing}
                  size="lg"
                >
                  <IconSearch size={16} />
                </ActionIcon>
              </Group>

              {/* 릴리즈 목록 */}
              <ScrollArea h={300} type="auto">
                <Stack gap="xs">
                  <Text size="xs" fw={600} c="dimmed" mb={4}>
                    📦 최근 릴리즈
                  </Text>

                  {allReleases.length === 0 ? (
                    <Text size="sm" c="dimmed" ta="center" py="xl">
                      검색 버튼을 클릭하거나<br />
                      버전을 입력 후 Enter를 눌러 검색하세요
                    </Text>
                  ) : filteredReleases.length === 0 ? (
                    <Text size="sm" c="dimmed" ta="center" py="xl">
                      검색 결과가 없습니다
                    </Text>
                  ) : (
                    <Radio.Group value={selectedRelease} onChange={setSelectedRelease}>
                      <Stack gap="xs">
                        {filteredReleases.map((release, idx) => {
                          const deployDate = release.dateReleased || release.dateCreated;
                          const versionCode = getVersionCode(release.version);
                          return (
                            <Card
                              key={release.version}
                              padding="sm"
                              withBorder
                              style={{
                                cursor: 'pointer',
                                borderColor: selectedRelease === release.version
                                  ? 'var(--mantine-color-blue-6)'
                                  : undefined
                              }}
                              onClick={() => setSelectedRelease(release.version)}
                            >
                              <Group wrap="nowrap">
                                <Radio value={release.version} />
                                <div style={{ flex: 1 }}>
                                  <Group gap="xs">
                                    <Text size="sm" fw={500}>
                                      {release.version}
                                    </Text>
                                    {idx === 0 && (
                                      <Badge size="xs" color="cyan">최신</Badge>
                                    )}
                                    {versionCode > 0 && (
                                      <Badge size="xs" color="gray" variant="light">
                                        +{versionCode}
                                      </Badge>
                                    )}
                                    {release.environmentMatched && (
                                      <Badge size="xs" color="green">★ 환경 일치</Badge>
                                    )}
                                  </Group>
                                  <Text size="xs" c="dimmed">
                                    {formatDateTime(deployDate)} 배포
                                  </Text>
                                  <Text size="xs" c="dimmed">
                                    {release.environments?.join(', ') || 'env 정보 없음'} · {getRelativeTime(deployDate || '')}
                                  </Text>
                                </div>
                              </Group>
                            </Card>
                          );
                        })}
                      </Stack>
                    </Radio.Group>
                  )}
                </Stack>
              </ScrollArea>
            </div>

            <Divider />

            {/* 모니터링 기간 */}
            <Select
              label="모니터링 기간"
              data={[
                { value: '1', label: '1일' },
                { value: '2', label: '2일' },
                { value: '3', label: '3일' }
              ]}
              value={duration}
              onChange={(val) => setDuration(val ?? '1')}
              allowDeselect={false}
            />

            {/* 액션 버튼 */}
            <Group justify="flex-end" gap="xs">
              <Button
                variant="subtle"
                onClick={() => setNewMonitorModalOpened(false)}
              >
                취소
              </Button>
              <Button
                type="submit"
                disabled={!selectedRelease}
                loading={startLoading}
              >
                {startLoading ? '시작 중...' : '모니터링 시작'}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* ========== 히스토리 상세보기 모달 ========== */}
      <Modal
        opened={historyModalOpened}
        onClose={() => setHistoryModalOpened(false)}
        title={<Text fw={700} size="lg">모니터링 히스토리</Text>}
        size="xl"
      >
        <Stack gap="md">
          {isLoadingHistories ? (
            <Text ta="center" c="dimmed" py="xl">
              히스토리를 불러오는 중...
            </Text>
          ) : monitorHistories.length === 0 ? (
            <Text ta="center" c="dimmed" py="xl">
              히스토리가 없습니다
            </Text>
          ) : (
            <ScrollArea h={500}>
              <Timeline active={-1} bulletSize={24} lineWidth={2}>
                {monitorHistories.map((history, idx) => (
                  <Timeline.Item
                    key={history.id}
                    bullet={
                      <Text size="xs" fw={700}>
                        {idx + 1}
                      </Text>
                    }
                    title={
                      <Group gap="xs">
                        <Text size="sm" fw={600}>
                          실행 완료
                        </Text>
                        {history.slack_sent && (
                          <Badge size="xs" color="green">Slack 전송</Badge>
                        )}
                      </Group>
                    }
                  >
                    <Text size="xs" c="dimmed" mb="xs">
                      {formatKST(history.executed_at)}
                    </Text>
                    <Stack gap="xs">
                      <Text size="sm">
                        📊 크래시: <strong>{history.events_count.toLocaleString()}건</strong>
                      </Text>
                      <Text size="sm">
                        🔍 고유 이슈: <strong>{history.issues_count}개</strong>
                      </Text>
                      <Text size="sm">
                        👥 영향 사용자: <strong>{history.users_count.toLocaleString()}명</strong>
                      </Text>
                      {history.top_issues && history.top_issues.length > 0 && (
                        <div>
                          <Text size="sm" fw={600} mt="xs" mb={4}>
                            Top 이슈:
                          </Text>
                          {history.top_issues.slice(0, 3).map((issue, issueIdx) => (
                            <Text key={issueIdx} size="xs" c="dimmed" ml="md">
                              • {issue.title || '(제목 없음)'} - {issue.events}건
                            </Text>
                          ))}
                        </div>
                      )}
                    </Stack>
                  </Timeline.Item>
                ))}
              </Timeline>
            </ScrollArea>
          )}
        </Stack>
      </Modal>
    </Container>
  );
}
