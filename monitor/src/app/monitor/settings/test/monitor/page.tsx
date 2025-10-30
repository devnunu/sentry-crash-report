'use client'

import React, { useState, useEffect, useMemo } from 'react'
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Modal,
  NumberInput,
  Progress,
  Radio,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  Timeline,
  Title
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconClock, IconFilter, IconPlayerPause, IconPlayerPlay, IconRefresh, IconSearch, IconSquare } from '@tabler/icons-react'
import type { Platform } from '@/lib/types'

// ===== Data Structures =====
interface TestMonitor {
  id: string
  platform: Platform
  version: string
  intervalMinutes: number
  durationDays: number
  startedAt: string
  nextRunAt: string
  runCount: number
  expectedRuns: number
  notificationsSent: number
  notificationsFailed: number
  lastNotificationAt: string | null
  isPaused: boolean
}

interface TestLog {
  id: string
  testId: string
  type: 'run' | 'notification' | 'error' | 'success'
  timestamp: string
  title: string
  message: string
  data?: any
  error?: string
}

interface Release {
  version: string
  dateReleased?: string
  dateCreated?: string
  environments?: string[]
  projectMatched?: boolean
  environmentMatched?: boolean
}

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

// ===== Helper Functions =====
function getNextRunTime(nextRunAt: string): string {
  const next = new Date(nextRunAt)
  const now = new Date()
  const diff = next.getTime() - now.getTime()

  if (diff < 0) return '곧 실행'

  const minutes = Math.floor(diff / 60000)
  const seconds = Math.floor((diff % 60000) / 1000)

  if (minutes > 0) return `${minutes}분 ${seconds}초 후`
  return `${seconds}초 후`
}

function getProgress(runCount: number, expectedRuns: number): number {
  if (expectedRuns === 0) return 0
  return Math.min(100, Math.round((runCount / expectedRuns) * 100))
}

function getNextCheckpoints(runCount: number, expectedRuns: number): string[] {
  const checkpoints: string[] = []
  const progress = (runCount / expectedRuns) * 100

  if (progress < 25) checkpoints.push('25% 완료')
  if (progress < 50) checkpoints.push('50% 완료')
  if (progress < 75) checkpoints.push('75% 완료')
  if (progress < 100) checkpoints.push('100% 완료')

  return checkpoints.slice(0, 2)
}

function getLogIcon(type: TestLog['type']): React.ReactNode {
  switch (type) {
    case 'run':
      return <IconPlayerPlay size={16} />
    case 'notification':
      return <IconClock size={16} />
    case 'error':
      return '❌'
    case 'success':
      return '✅'
    default:
      return '📝'
  }
}

function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr)
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date)
}

function getRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}일 전`
  if (hours > 0) return `${hours}시간 전`
  if (minutes > 0) return `${minutes}분 전`
  return '방금 전'
}

// 베이스 버전 추출 - API 전송용 (4.72.0.0+546 → 4.72.0)
function getBaseVersionForAPI(version: string): string {
  const withoutBuildNumber = version.split('+')[0].split('-')[0]
  const parts = withoutBuildNumber.split('.')
  // 처음 3개 부분만 추출 (x.y.z 형식)
  return parts.slice(0, 3).join('.')
}

// 전체 버전 (빌드 번호 제외) - 중복 제거용 (4.72.0.0+546 → 4.72.0.0)
function getVersionWithoutBuild(version: string): string {
  return version.split('+')[0].split('-')[0]
}

// 버전 코드 추출 (4.72.0+920 → 920)
function getVersionCode(version: string): number {
  const parts = version.split('+')
  if (parts.length > 1) {
    const code = parseInt(parts[1])
    return isNaN(code) ? 0 : code
  }
  return 0
}

// 중복 제거 (같은 버전 + 빌드 번호 다른 것만 중복 처리)
// 예: 4.72.0+912와 4.72.0+920 → 920만 남음
// 예: 4.72.0+912와 4.72.0.0+546 → 둘 다 유지 (다른 버전)
function deduplicateReleases(releases: Release[]): Release[] {
  const versionMap = new Map<string, Release>()

  releases.forEach(release => {
    // 빌드 번호를 제외한 전체 버전을 키로 사용 (4.72.0.0+546 → 4.72.0.0)
    const versionKey = getVersionWithoutBuild(release.version)
    const existing = versionMap.get(versionKey)

    if (!existing) {
      versionMap.set(versionKey, release)
      return
    }

    // 버전 코드 비교
    const releaseCode = getVersionCode(release.version)
    const existingCode = getVersionCode(existing.version)

    if (releaseCode !== existingCode) {
      if (releaseCode > existingCode) {
        versionMap.set(versionKey, release)
      }
      return
    }

    // 버전 코드가 같으면 날짜로 비교
    const releaseDate = new Date(release.dateReleased || release.dateCreated || 0)
    const existingDate = new Date(existing.dateReleased || existing.dateCreated || 0)

    if (releaseDate > existingDate) {
      versionMap.set(versionKey, release)
    }
  })

  return Array.from(versionMap.values())
}

export default function MonitorTestPage() {
  // Form state for new tests
  const [platform, setPlatform] = useState<Platform>('android')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedRelease, setSelectedRelease] = useState('')
  const [duration, setDuration] = useState('1')
  const [intervalMinutes, setIntervalMinutes] = useState(5)
  const [isStarting, setIsStarting] = useState(false)

  // Release search state
  const [allReleases, setAllReleases] = useState<Release[]>([])
  const [isSearching, setIsSearching] = useState(false)

  // Active tests state
  const [activeTests, setActiveTests] = useState<TestMonitor[]>([])
  const [isLoadingActive, setIsLoadingActive] = useState(true)

  // Logs modal state
  const [logsModalOpened, setLogsModalOpened] = useState(false)
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null)
  const [logs, setLogs] = useState<TestLog[]>([])
  const [logFilter, setLogFilter] = useState<'all' | 'run' | 'notification' | 'error'>('all')
  const [isLoadingLogs, setIsLoadingLogs] = useState(false)

  // History state
  const [history, setHistory] = useState<TestMonitor[]>([])
  const [isLoadingHistory, setIsLoadingHistory] = useState(true)

  // Platform 변경 시 초기화
  useEffect(() => {
    setSearchQuery('')
    setSelectedRelease('')
    setAllReleases([])
  }, [platform])

  // Load active tests on mount
  useEffect(() => {
    loadActiveTests()
    loadHistory()

    // Refresh every 30 seconds
    const interval = setInterval(() => {
      loadActiveTests()
    }, 30000)

    return () => clearInterval(interval)
  }, [])

  // 필터링된 릴리즈 (중복 제거, 정렬)
  const filteredReleases = useMemo(() => {
    let releases = [...allReleases]

    // 검색어 필터링
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      releases = releases.filter(r =>
        r.version.toLowerCase().includes(query)
      )
    }

    // 중복 제거
    releases = deduplicateReleases(releases)

    // 최신순 정렬 (날짜 우선, 버전 코드는 부차적)
    releases.sort((a, b) => {
      // 먼저 날짜로 비교
      const dateA = new Date(a.dateReleased || a.dateCreated || 0)
      const dateB = new Date(b.dateReleased || b.dateCreated || 0)

      if (dateA.getTime() !== dateB.getTime()) {
        return dateB.getTime() - dateA.getTime()
      }

      // 날짜가 같으면 버전 코드로 비교
      const codeA = getVersionCode(a.version)
      const codeB = getVersionCode(b.version)
      return codeB - codeA
    })

    return releases.slice(0, 10)
  }, [allReleases, searchQuery])

  const searchReleases = async () => {
    if (!searchQuery.trim()) {
      notifications.show({ color: 'orange', message: '검색어를 입력해주세요' })
      return
    }

    setIsSearching(true)

    try {
      const params = new URLSearchParams({
        platform,
        baseRelease: searchQuery.trim()
      })

      const response = await fetch(`/api/monitor/releases?${params.toString()}`)
      const result = await response.json()

      if (!response.ok || !result.success) {
        throw new Error(result.error || '릴리즈 검색에 실패했습니다')
      }

      const releases = result.data?.releases || []
      setAllReleases(releases)

      if (releases.length === 0) {
        notifications.show({ color: 'orange', message: '검색 결과가 없습니다' })
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다'
      notifications.show({ color: 'red', message: `릴리즈 검색 실패: ${m}` })
    } finally {
      setIsSearching(false)
    }
  }

  const loadActiveTests = async () => {
    try {
      const response = await fetch('/api/test-monitors/active')
      const result: ApiResponse<TestMonitor[]> = await response.json()

      if (result.success && result.data) {
        setActiveTests(result.data)
      }
    } catch (error) {
      console.error('Failed to load active tests:', error)
    } finally {
      setIsLoadingActive(false)
    }
  }

  const loadHistory = async () => {
    try {
      const response = await fetch('/api/test-monitors/history?limit=5')
      const result: ApiResponse<TestMonitor[]> = await response.json()

      if (result.success && result.data) {
        setHistory(result.data)
      }
    } catch (error) {
      console.error('Failed to load history:', error)
    } finally {
      setIsLoadingHistory(false)
    }
  }

  const loadLogs = async (testId: string) => {
    setIsLoadingLogs(true)
    try {
      const response = await fetch(`/api/test-monitors/${testId}/logs?type=${logFilter}`)
      const result: ApiResponse<TestLog[]> = await response.json()

      if (result.success && result.data) {
        setLogs(result.data)
      }
    } catch (error) {
      console.error('Failed to load logs:', error)
      notifications.show({ color: 'red', message: '로그를 불러오는데 실패했습니다.' })
    } finally {
      setIsLoadingLogs(false)
    }
  }

  const handleStartTest = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!selectedRelease) {
      notifications.show({ color: 'red', message: '베이스 릴리즈를 선택해주세요.' })
      return
    }

    setIsStarting(true)

    try {
      // 전체 버전에서 베이스 버전만 추출 (4.72.0.0+546 → 4.72.0)
      const baseReleaseOnly = getBaseVersionForAPI(selectedRelease)

      const response = await fetch('/api/monitor/start-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          baseRelease: baseReleaseOnly,
          matchedRelease: selectedRelease, // 선택한 전체 버전을 전송
          days: parseInt(duration),
          isTestMode: true,
          customInterval: intervalMinutes
        })
      })

      const result: ApiResponse<any> = await response.json()

      if (!response.ok || !result.success) {
        throw new Error(result.error || '테스트 시작에 실패했습니다.')
      }

      notifications.show({ color: 'green', message: '테스트 모니터링이 시작되었습니다.' })
      setSelectedRelease('')
      setSearchQuery('')
      setAllReleases([])
      await loadActiveTests()
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'
      notifications.show({ color: 'red', message })
    } finally {
      setIsStarting(false)
    }
  }

  const handlePauseTest = async (testId: string) => {
    try {
      const response = await fetch(`/api/test-monitors/${testId}/pause`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' }
      })

      const result: ApiResponse<any> = await response.json()

      if (!response.ok || !result.success) {
        throw new Error(result.error || '일시정지에 실패했습니다.')
      }

      notifications.show({ color: 'orange', message: '테스트가 일시정지되었습니다.' })
      await loadActiveTests()
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'
      notifications.show({ color: 'red', message })
    }
  }

  const handleStopTest = async (testId: string) => {
    try {
      const response = await fetch(`/api/test-monitors/${testId}`, {
        method: 'DELETE'
      })

      const result: ApiResponse<any> = await response.json()

      if (!response.ok || !result.success) {
        throw new Error(result.error || '중지에 실패했습니다.')
      }

      notifications.show({ color: 'red', message: '테스트가 중지되었습니다.' })
      await loadActiveTests()
      await loadHistory()
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'
      notifications.show({ color: 'red', message })
    }
  }

  const openLogsModal = (testId: string) => {
    setSelectedTestId(testId)
    setLogsModalOpened(true)
    loadLogs(testId)
  }

  useEffect(() => {
    if (selectedTestId && logsModalOpened) {
      loadLogs(selectedTestId)
    }
  }, [logFilter])

  const filteredLogs = logs.filter(log => {
    if (logFilter === 'all') return true
    return log.type === logFilter
  })

  return (
    <div className="container">
      <Group justify="space-between" align="flex-start" mb="xl">
        <div>
          <Title order={2}>📡 모니터링 테스트 대시보드</Title>
          <Text c="dimmed" size="sm">실시간 진행 상황과 검증 체크리스트를 확인하세요</Text>
        </div>
        <Button
          leftSection={<IconRefresh size={16} />}
          variant="light"
          onClick={() => {
            loadActiveTests()
            loadHistory()
          }}
        >
          새로고침
        </Button>
      </Group>

      {/* Section 1: Active Tests */}
      <Card withBorder radius="md" p="xl" mb="xl" style={{ background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.05) 0%, rgba(16, 185, 129, 0.05) 100%)', borderColor: 'rgba(34, 197, 94, 0.2)' }}>
        <Stack gap="md">
          <Group justify="space-between">
            <div>
              <Text size="lg" fw={600}>진행 중인 테스트</Text>
              <Text size="xs" c="dimmed">활성 모니터링 테스트의 진행 상황</Text>
            </div>
            {activeTests.length > 0 && (
              <Badge color="green" variant="light" size="lg">{activeTests.length}개 실행 중</Badge>
            )}
          </Group>

          {isLoadingActive ? (
            <Text c="dimmed" ta="center" py="xl">로딩 중...</Text>
          ) : activeTests.length === 0 ? (
            <Card withBorder p="xl" style={{ backgroundColor: 'rgba(148, 163, 184, 0.05)' }}>
              <Stack align="center" gap="xs">
                <Text c="dimmed" size="sm">진행 중인 테스트가 없습니다</Text>
                <Text c="dimmed" size="xs">아래 폼에서 새 테스트를 시작하세요</Text>
              </Stack>
            </Card>
          ) : (
            <Stack gap="md">
              {activeTests.map(test => {
                const progress = getProgress(test.runCount, test.expectedRuns)
                const checkpoints = getNextCheckpoints(test.runCount, test.expectedRuns)
                const notificationSuccess = test.notificationsSent - test.notificationsFailed

                return (
                  <Card key={test.id} padding="lg" withBorder style={test.isPaused ? { backgroundColor: 'rgba(234, 179, 8, 0.05)' } : undefined}>
                    <Stack gap="md">
                      {/* 헤더 */}
                      <Group justify="space-between">
                        <Group gap="xs">
                          <Text size="lg" fw={600}>
                            {test.platform === 'android' ? '🤖' : '🍎'} {test.platform.toUpperCase()} {test.version}
                          </Text>
                          <Badge color="violet" variant="light" size="sm">
                            테스트 모드
                          </Badge>
                          {test.isPaused && <Badge color="yellow">일시정지</Badge>}
                        </Group>
                        <Group gap="xs">
                          <ActionIcon
                            variant="light"
                            color={test.isPaused ? 'green' : 'yellow'}
                            onClick={() => handlePauseTest(test.id)}
                          >
                            {test.isPaused ? <IconPlayerPlay size={16} /> : <IconPlayerPause size={16} />}
                          </ActionIcon>
                          <ActionIcon
                            variant="light"
                            color="red"
                            onClick={() => handleStopTest(test.id)}
                          >
                            <IconSquare size={16} />
                          </ActionIcon>
                        </Group>
                      </Group>

                      {/* 진행 상황 */}
                      <div>
                        <Text size="sm" fw={600} mb={4}>🗓️ 진행 상황</Text>
                        <Stack gap="xs">
                          <Text size="sm" c="dimmed">
                            • 시작: {formatDateTime(test.startedAt)}
                          </Text>
                          <Text size="sm" c="dimmed">
                            • 실행 간격: {test.intervalMinutes}분마다
                          </Text>
                          <Text size="sm" c="dimmed">
                            • 다음 실행: {test.isPaused ? '일시정지됨' : getNextRunTime(test.nextRunAt)}
                          </Text>
                          <Group gap="xs">
                            <Text size="sm" c="dimmed">• 진행률:</Text>
                            <Progress
                              value={progress}
                              style={{ flex: 1 }}
                              color={progress > 80 ? 'orange' : 'blue'}
                            />
                            <Text size="sm" fw={500}>
                              {progress}%
                            </Text>
                          </Group>
                          <Text size="sm" c="dimmed">
                            • 실행 횟수: {test.runCount} / {test.expectedRuns}회
                          </Text>
                        </Stack>
                      </div>

                      {/* 알림 상태 */}
                      <div>
                        <Text size="sm" fw={600} mb={4}>📊 알림 상태</Text>
                        <Stack gap="xs">
                          <Text size="sm">
                            • 발송 성공: {notificationSuccess}건
                          </Text>
                          <Text size="sm">
                            • 발송 실패: {test.notificationsFailed}건
                          </Text>
                          {test.lastNotificationAt && (
                            <Text size="sm" c="dimmed">
                              • 마지막 발송: {formatDateTime(test.lastNotificationAt)}
                            </Text>
                          )}
                        </Stack>
                      </div>

                      {checkpoints.length > 0 && (
                        <div>
                          <Text size="sm" fw={600} mb={4}>🎯 다음 체크포인트</Text>
                          <Group gap="xs">
                            {checkpoints.map((checkpoint, idx) => (
                              <Badge key={idx} variant="light" color="violet">
                                {checkpoint}
                              </Badge>
                            ))}
                          </Group>
                        </div>
                      )}

                      {/* 액션 버튼 */}
                      <Group gap="xs">
                        <Button
                          size="sm"
                          variant="light"
                          leftSection={<IconClock size={16} />}
                          onClick={() => openLogsModal(test.id)}
                        >
                          실시간 로그
                        </Button>
                      </Group>
                    </Stack>
                  </Card>
                )
              })}
            </Stack>
          )}
        </Stack>
      </Card>

      {/* New Test Form */}
      <Card withBorder radius="md" p="xl" mb="xl" style={{ background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.05) 0%, rgba(147, 51, 234, 0.05) 100%)', borderColor: 'rgba(168, 85, 247, 0.2)' }}>
        <form onSubmit={handleStartTest}>
          <Stack gap="md">
            <Text size="lg" fw={600}>새 테스트 시작</Text>

            {/* 플랫폼 선택 */}
            <Select
              label="플랫폼"
              data={[
                { value: 'android', label: 'Android' },
                { value: 'ios', label: 'iOS' }
              ]}
              value={platform}
              onChange={val => setPlatform((val as Platform) ?? 'android')}
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
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      searchReleases()
                    }
                  }}
                  style={{ flex: 1 }}
                />
                <ActionIcon
                  variant="light"
                  onClick={searchReleases}
                  loading={isSearching}
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
                    <Radio.Group
                      value={selectedRelease}
                      onChange={setSelectedRelease}
                    >
                      <Stack gap="xs">
                        {filteredReleases.map((release, idx) => {
                          const deployDate = release.dateReleased || release.dateCreated
                          const versionCode = getVersionCode(release.version)
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
                          )
                        })}
                      </Stack>
                    </Radio.Group>
                  )}
                </Stack>
              </ScrollArea>
            </div>

            <Divider />

            {/* 모니터링 설정 */}
            <Select
              label="모니터링 기간"
              data={[
                { value: '1', label: '1일' },
                { value: '2', label: '2일' },
                { value: '3', label: '3일' }
              ]}
              value={duration}
              onChange={val => setDuration(val ?? '1')}
              allowDeselect={false}
            />

            <NumberInput
              label="테스트 실행 간격 (분)"
              description="테스트 모드 전용 설정"
              value={intervalMinutes}
              onChange={value => setIntervalMinutes(Number(value) || 5)}
              min={1}
              max={60}
            />

            <Button
              type="submit"
              color="violet"
              leftSection="🚀"
              loading={isStarting}
              disabled={!selectedRelease}
            >
              {isStarting ? '시작 중...' : '테스트 시작'}
            </Button>
          </Stack>
        </form>
      </Card>

      {/* Section 2: History */}
      <Card withBorder radius="md" p="xl" style={{ background: 'linear-gradient(135deg, rgba(148, 163, 184, 0.05) 0%, rgba(100, 116, 139, 0.05) 100%)', borderColor: 'rgba(148, 163, 184, 0.2)' }}>
        <Stack gap="md">
          <Text size="lg" fw={600}>최근 테스트 히스토리</Text>

          {isLoadingHistory ? (
            <Text c="dimmed" ta="center" py="xl">로딩 중...</Text>
          ) : history.length === 0 ? (
            <Card withBorder p="xl" style={{ backgroundColor: 'rgba(148, 163, 184, 0.05)' }}>
              <Text c="dimmed" size="sm" ta="center">히스토리가 없습니다</Text>
            </Card>
          ) : (
            <Stack gap="xs">
              {history.map(test => {
                const progress = getProgress(test.runCount, test.expectedRuns)
                const isSuccess = progress === 100 && test.notificationsFailed === 0

                return (
                  <Card key={test.id} withBorder p="md" style={{ backgroundColor: isSuccess ? 'rgba(34, 197, 94, 0.05)' : 'rgba(239, 68, 68, 0.05)' }}>
                    <Group justify="space-between">
                      <div>
                        <Group gap="xs">
                          <Badge color={test.platform === 'android' ? 'blue' : 'gray'} size="sm">
                            {test.platform === 'android' ? 'Android' : 'iOS'}
                          </Badge>
                          <Text size="sm" fw={500}>{test.version}</Text>
                          <Badge color={isSuccess ? 'green' : 'red'} size="sm">
                            {isSuccess ? '성공' : '실패'}
                          </Badge>
                        </Group>
                        <Text size="xs" c="dimmed" mt={4}>
                          {getRelativeTime(test.startedAt)} · {test.runCount}/{test.expectedRuns} 실행 · 알림 {test.notificationsSent - test.notificationsFailed}/{test.notificationsSent}
                        </Text>
                      </div>
                      <Button
                        variant="subtle"
                        size="xs"
                        onClick={() => openLogsModal(test.id)}
                      >
                        로그 보기
                      </Button>
                    </Group>
                  </Card>
                )
              })}
            </Stack>
          )}
        </Stack>
      </Card>

      {/* Section 3: Real-time Logs Modal */}
      <Modal
        opened={logsModalOpened}
        onClose={() => setLogsModalOpened(false)}
        title="실시간 로그"
        size="xl"
      >
        <Stack gap="md">
          <Group justify="space-between">
            <Group gap="xs">
              <ActionIcon
                variant={logFilter === 'all' ? 'filled' : 'light'}
                onClick={() => setLogFilter('all')}
              >
                <IconFilter size={16} />
              </ActionIcon>
              <Badge
                variant={logFilter === 'run' ? 'filled' : 'light'}
                style={{ cursor: 'pointer' }}
                onClick={() => setLogFilter('run')}
              >
                실행
              </Badge>
              <Badge
                variant={logFilter === 'notification' ? 'filled' : 'light'}
                color="blue"
                style={{ cursor: 'pointer' }}
                onClick={() => setLogFilter('notification')}
              >
                알림
              </Badge>
              <Badge
                variant={logFilter === 'error' ? 'filled' : 'light'}
                color="red"
                style={{ cursor: 'pointer' }}
                onClick={() => setLogFilter('error')}
              >
                에러
              </Badge>
            </Group>
            <Button
              size="xs"
              variant="light"
              leftSection={<IconRefresh size={14} />}
              onClick={() => selectedTestId && loadLogs(selectedTestId)}
              loading={isLoadingLogs}
            >
              새로고침
            </Button>
          </Group>

          <Group grow>
            <Card withBorder p="sm" style={{ backgroundColor: 'rgba(59, 130, 246, 0.05)' }}>
              <Text size="xs" c="dimmed">총 실행</Text>
              <Text size="lg" fw={600} c="blue">{logs.filter(l => l.type === 'run').length}</Text>
            </Card>
            <Card withBorder p="sm" style={{ backgroundColor: 'rgba(34, 197, 94, 0.05)' }}>
              <Text size="xs" c="dimmed">알림 발송</Text>
              <Text size="lg" fw={600} c="green">{logs.filter(l => l.type === 'notification').length}</Text>
            </Card>
            <Card withBorder p="sm" style={{ backgroundColor: 'rgba(239, 68, 68, 0.05)' }}>
              <Text size="xs" c="dimmed">에러</Text>
              <Text size="lg" fw={600} c="red">{logs.filter(l => l.type === 'error').length}</Text>
            </Card>
          </Group>

          <Divider />

          <ScrollArea h={400}>
            {isLoadingLogs ? (
              <Text c="dimmed" ta="center" py="xl">로딩 중...</Text>
            ) : filteredLogs.length === 0 ? (
              <Text c="dimmed" ta="center" py="xl">로그가 없습니다</Text>
            ) : (
              <Timeline active={filteredLogs.length} bulletSize={24} lineWidth={2}>
                {filteredLogs.map(log => (
                  <Timeline.Item
                    key={log.id}
                    bullet={getLogIcon(log.type)}
                    title={log.title}
                  >
                    <Text size="xs" c="dimmed" mb={4}>{formatDateTime(log.timestamp)}</Text>
                    <Text size="sm">{log.message}</Text>
                    {log.error && (
                      <Card withBorder p="xs" mt="xs" style={{ backgroundColor: 'rgba(239, 68, 68, 0.05)' }}>
                        <Text size="xs" c="red">{log.error}</Text>
                      </Card>
                    )}
                    {log.data && (
                      <Card withBorder p="xs" mt="xs" style={{ backgroundColor: 'rgba(148, 163, 184, 0.05)' }}>
                        <Text size="xs" c="dimmed" style={{ fontFamily: 'monospace' }}>
                          {JSON.stringify(log.data, null, 2)}
                        </Text>
                      </Card>
                    )}
                  </Timeline.Item>
                ))}
              </Timeline>
            )}
          </ScrollArea>
        </Stack>
      </Modal>
    </div>
  )
}
