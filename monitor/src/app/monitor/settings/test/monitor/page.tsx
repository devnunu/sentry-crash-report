'use client'

import React, { useState } from 'react'
import {
  Badge,
  Button,
  Card,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
  Title
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import type { Platform } from '@/lib/types'

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

interface StartMonitorData {
  monitorId: string
  message: string
  interval: string
  cronExpression: string
  scheduleId?: string
  scheduleWarning?: string | null
  immediateResult?: {
    processedCount: number
    skippedCount: number
    errorCount: number
    results: Array<{
      status: 'success' | 'error' | 'skipped'
      error?: string
      aggregation?: { events: number; issues: number; users: number }
      customIntervalMinutes?: number
      windowStart?: string
      windowEnd?: string
    }>
  }
}

interface StopMonitorData {
  monitorId: string
  message: string
}

export default function MonitorTestPage() {
  const [monitorPlatform, setMonitorPlatform] = useState<Platform>('android')
  const [monitorBaseRelease, setMonitorBaseRelease] = useState('')
  const [monitorDays, setMonitorDays] = useState(7)
  const [monitorInterval, setMonitorInterval] = useState(5)
  const [currentMonitorId, setCurrentMonitorId] = useState<string | null>(null)
  const [isMonitorRunning, setIsMonitorRunning] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const [scheduleWarning, setScheduleWarning] = useState<string | null>(null)
  const [lastTickSummary, setLastTickSummary] = useState<string | null>(null)

  const handleMonitorStart = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!monitorBaseRelease.trim()) {
      notifications.show({ color: 'red', message: '베이스 릴리즈를 입력해주세요.' })
      return
    }

    setIsStarting(true)
    setScheduleWarning(null)
    setLastTickSummary(null)

    try {
      const response = await fetch('/api/monitor/start-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: monitorPlatform,
          baseRelease: monitorBaseRelease.trim(),
          days: monitorDays,
          isTestMode: true,
          customInterval: monitorInterval
        })
      })

      const result: ApiResponse<StartMonitorData & { session?: unknown }> = await response.json()

      if (!response.ok || !result.success || !result.data) {
        const errorMessage = result.error || '모니터링 시작에 실패했습니다.'
        throw new Error(errorMessage)
      }

      setCurrentMonitorId(result.data.monitorId)
      setIsMonitorRunning(true)
      notifications.show({
        color: 'green',
        message: result.data.message || `모니터링이 시작되었습니다. (${monitorInterval}분 간격)`
      })

      setScheduleWarning(result.data.scheduleWarning ?? null)

      if (result.data.immediateResult?.results?.length) {
        const immediate = result.data.immediateResult.results[0]
        if (immediate.status === 'success') {
          const total = immediate.totalAggregation ?? immediate.aggregation
          const windowAgg = immediate.aggregation
          const totalEvents = total?.events ?? 0
          const totalIssues = total?.issues ?? 0
          const totalUsers = total?.users ?? 0
          const windowEvents = windowAgg?.events ?? 0
          setLastTickSummary(`✅ 즉시 실행 완료 · 누적 이벤트 ${totalEvents.toLocaleString()}건 / 최근 ${monitorInterval}분 ${windowEvents.toLocaleString()}건 · 누적 이슈 ${totalIssues.toLocaleString()}개 · 누적 사용자 ${totalUsers.toLocaleString()}명`)
        } else if (immediate.status === 'skipped') {
          setLastTickSummary('⏸️ 즉시 실행이 조건을 충족하지 않아 건너뛰었습니다.')
        } else {
          const error = immediate.error ? ` (${immediate.error})` : ''
          setLastTickSummary(`❌ 즉시 실행 실패${error}`)
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'
      notifications.show({ color: 'red', message: `모니터링 시작 실패: ${message}` })
    } finally {
      setIsStarting(false)
    }
  }

  const handleMonitorStop = async () => {
    if (!currentMonitorId || isStopping) return

    setIsStopping(true)

    try {
      const response = await fetch('/api/monitor/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monitorId: currentMonitorId })
      })

      const result: ApiResponse<StopMonitorData> = await response.json()

      if (!response.ok || !result.success || !result.data) {
        const errorMessage = result.error || '모니터링 중지에 실패했습니다.'
        throw new Error(errorMessage)
      }

      setCurrentMonitorId(null)
      setIsMonitorRunning(false)
      setScheduleWarning(null)
      setLastTickSummary(null)
      notifications.show({ color: 'orange', message: result.data.message || '모니터링이 중지되었습니다.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.'
      notifications.show({ color: 'red', message: `모니터링 중지 실패: ${message}` })
    } finally {
      setIsStopping(false)
    }
  }

  return (
    <div className="container">
      <Group justify="space-between" align="flex-start" mb="sm">
        <div>
          <Title order={2}>📡 모니터링 테스트 실행</Title>
          <Text c="dimmed" size="sm">분 단위 간격으로 모니터를 실행해 빠르게 동작을 검증합니다.</Text>
        </div>
        {isMonitorRunning && (
          <Badge color="green" variant="light" size="lg">실행 중</Badge>
        )}
      </Group>

      <Card withBorder radius="lg" p="xl" style={{ background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.05) 0%, rgba(147, 51, 234, 0.05) 100%)', borderColor: 'rgba(168, 85, 247, 0.2)' }}>
        <form onSubmit={handleMonitorStart}>
          <Stack gap="md">
            <Group grow>
              <Select
                label="대상 플랫폼"
                description="모니터링할 플랫폼을 선택하세요"
                data={[
                  { value: 'android', label: '🤖 Android' },
                  { value: 'ios', label: '🍎 iOS' }
                ]}
                value={monitorPlatform}
                onChange={value => setMonitorPlatform((value as Platform) ?? 'android')}
                size="md"
              />
              <TextInput
                label="베이스 릴리즈"
                description="예: 4.69.0"
                placeholder="4.69.0"
                value={monitorBaseRelease}
                onChange={event => setMonitorBaseRelease(event.currentTarget.value)}
                size="md"
                required
              />
            </Group>

            <Group grow>
              <NumberInput
                label="모니터링 기간 (일)"
                description="모니터를 유지할 기간"
                value={monitorDays}
                onChange={value => setMonitorDays(Number(value) || 7)}
                min={1}
                max={30}
                size="md"
              />
              <NumberInput
                label="테스트 간격 (분)"
                description="테스트 모드 실행 간격"
                value={monitorInterval}
                onChange={value => setMonitorInterval(Number(value) || 5)}
                min={1}
                max={60}
                size="md"
              />
            </Group>

            <Group grow>
              {!isMonitorRunning ? (
                <Button
                  type="submit"
                  color="violet"
                  size="md"
                  leftSection="🚀"
                  loading={isStarting}
                  disabled={!monitorBaseRelease.trim() || isStarting}
                >
                  모니터링 시작
                </Button>
              ) : (
                <Button
                  color="red"
                  variant="light"
                  size="md"
                  leftSection="⏹️"
                  onClick={handleMonitorStop}
                  loading={isStopping}
                >
                  모니터링 중지
                </Button>
              )}
            </Group>

            {isMonitorRunning && currentMonitorId && (
              <Card withBorder p="md" style={{ backgroundColor: 'rgba(34, 197, 94, 0.1)', borderColor: 'rgba(34, 197, 94, 0.3)' }}>
                <Group justify="space-between" align="center">
                  <div>
                    <Text size="sm" fw={500}>✅ 모니터링 실행 중</Text>
                    <Text size="xs" c="dimmed">모니터 ID: {currentMonitorId}</Text>
                    <Text size="xs" c="dimmed">간격: {monitorInterval}분마다</Text>
                  </div>
                  <Button variant="light" size="xs" component="a" href="/monitor" target="_blank">
                    대시보드 보기
                  </Button>
                </Group>
              </Card>
            )}

            {lastTickSummary && (
              <Card withBorder p="md" radius="md" style={{ backgroundColor: 'rgba(34, 197, 94, 0.08)', borderColor: 'rgba(34, 197, 94, 0.2)' }}>
                <Text size="sm" fw={500}>{lastTickSummary}</Text>
              </Card>
            )}

            {scheduleWarning && (
              <Card withBorder p="md" radius="md" style={{ backgroundColor: 'rgba(234, 179, 8, 0.08)', borderColor: 'rgba(234, 179, 8, 0.2)' }}>
                <Text size="sm" c="yellow.6" fw={500}>⚠️ {scheduleWarning}</Text>
                <Text size="xs" c="dimmed" mt={4}>
                  로컬 개발 환경에서는 QStash가 호출하지 못할 수 있으니 필요 시 `/api/monitor/tick` 엔드포인트를 수동으로 호출하세요.
                </Text>
              </Card>
            )}
          </Stack>
        </form>
      </Card>

      <Card withBorder p="md" mt="xl" style={{ backgroundColor: 'rgba(147, 51, 234, 0.03)', borderColor: 'rgba(147, 51, 234, 0.1)' }}>
        <Stack gap="xs">
          <Text size="sm" fw={500} c="violet.6">💡 사용 가이드</Text>
          <Text size="xs" c="dimmed">
            테스트 모니터는 지정한 간격으로 빠르게 실행됩니다. 실제 운영 모니터는 1시간 간격으로 동작하므로 테스트 후 반드시 중지하세요.
          </Text>
        </Stack>
      </Card>
    </div>
  )
}
