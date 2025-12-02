'use client'

import React, {useEffect, useRef, useState} from 'react'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  Title
} from '@mantine/core'
import {notifications} from '@mantine/notifications'
import type {GenerateDailyReportRequest, Platform} from '@/lib/reports/types'

type GenerationStatus = 'idle' | 'running' | 'completed' | 'error'

interface LogEntry {
  type: 'log' | 'error' | 'success'
  message: string
  timestamp: string
  data?: unknown
}

const getStatusInfo = (status: GenerationStatus) => {
  switch (status) {
    case 'running':
      return { color: 'blue', text: '실행 중', icon: '⏳' }
    case 'completed':
      return { color: 'green', text: '완료', icon: '✅' }
    case 'error':
      return { color: 'red', text: '오류', icon: '❌' }
    default:
      return { color: 'gray', text: '대기', icon: '⚪' }
  }
}

export default function ReportTestPage() {
  const [loading, setLoading] = useState(false)
  const [includeAI, setIncludeAI] = useState(true)
  const [sendSlack, setSendSlack] = useState(true)
  const [isTestMode, setIsTestMode] = useState(false)
  const [platform, setPlatform] = useState<Platform | 'all'>('all')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [status, setStatus] = useState<GenerationStatus>('idle')
  const logsEndRef = useRef<HTMLDivElement>(null)
  const [targetDate, setTargetDate] = useState('')

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs])

  const clearLogs = () => {
    setLogs([])
    setStatus('idle')
  }

  const appendErrorLog = (message: string) => {
    setLogs(prev => [
      ...prev,
      {
        type: 'error',
        message,
        timestamp: new Date().toISOString()
      }
    ])
  }

  const startStreaming = (endpoint: string, requestData: GenerateDailyReportRequest) => {
    setLogs([])
    setStatus('running')
    setLoading(true)

    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData)
    })
      .then(response => {
        if (!response.body) {
          throw new Error('스트림 응답이 없습니다')
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()

        const readStream = async () => {
          try {
            while (true) {
              const { value, done } = await reader.read()
              if (done) break

              const chunk = decoder.decode(value, { stream: true })
              const lines = chunk.split('\n')

              lines.forEach(line => {
                if (!line.startsWith('data: ')) return

                try {
                  const data = JSON.parse(line.slice(6))
                  const logEntry: LogEntry = {
                    type: data.type,
                    message: data.message,
                    timestamp: data.timestamp,
                    data: data.data
                  }

                  setLogs(prev => [...prev, logEntry])

                  if (data.type === 'success') {
                    setStatus('completed')
                    setLoading(false)
                    notifications.show({ color: 'green', message: '리포트 생성이 완료되었습니다!' })
                  } else if (data.type === 'error') {
                    setStatus('error')
                    setLoading(false)
                    notifications.show({ color: 'red', message: data.message || '리포트 생성 중 오류가 발생했습니다.' })
                  }
                } catch (parseError) {
                  console.warn('Failed to parse SSE data:', parseError)
                }
              })
            }
          } catch (streamError) {
            console.error('Stream reading error:', streamError)
            setStatus('error')
            setLoading(false)
            appendErrorLog(`스트림 오류: ${streamError instanceof Error ? streamError.message : String(streamError)}`)
          }
        }

        readStream()
      })
      .catch(error => {
        console.error('Fetch error:', error)
        setStatus('error')
        setLoading(false)
        appendErrorLog(`연결 오류: ${error instanceof Error ? error.message : String(error)}`)
        notifications.show({ color: 'red', message: '리포트 생성 요청에 실패했습니다.' })
      })
  }

  const handleDailyGenerate = (event: React.FormEvent) => {
    event.preventDefault()

    const request: GenerateDailyReportRequest = {
      targetDate: targetDate || undefined,
      sendSlack,
      includeAI,
      isTestMode,
      platform: platform === 'all' ? undefined : (platform as Platform)
    }

    startStreaming('/api/reports/daily/generate-stream', request)
  }

  return (
    <div className="container">
      <Group justify="space-between" align="flex-start" mb="sm">
        <div>
          <Title order={2}>📊 리포트 테스트 실행</Title>
          <Text c="dimmed" size="sm">일간 리포트를 수동으로 생성해 검증할 수 있습니다.</Text>
        </div>
      </Group>

      <Stack gap="xl" mt="md">
        <Card withBorder radius="lg" p="xl" style={{ background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.05) 0%, rgba(168, 85, 247, 0.05) 100%)', borderColor: 'rgba(99, 102, 241, 0.2)' }}>
          <Stack gap="xl">
            <Card withBorder p="lg" radius="md" style={{ backgroundColor: 'rgba(255, 255, 255, 0.03)' }}>
              <Text fw={600} mb="md" c="indigo.5">⚙️ 공통 설정</Text>
              <Stack gap="md">
                <Select
                  label="대상 플랫폼"
                  description={platform === 'all'
                    ? "Android, iOS 각각 리포트 생성 및 Slack 메시지 발송 (총 2개)"
                    : "선택한 플랫폼에 대해서만 리포트 생성"}
                  data={[
                    { value: 'all', label: '🌐 전체 플랫폼 (Android + iOS)' },
                    { value: 'android', label: '🤖 Android만' },
                    { value: 'ios', label: '🍎 iOS만' }
                  ]}
                  value={platform}
                  onChange={val => setPlatform((val as Platform | 'all') ?? 'all')}
                  size="md"
                />
                <Group grow>
                  <Checkbox
                    label="🤖 AI 분석 포함"
                    description="OpenAI를 활용한 이슈 분석 포함"
                    checked={includeAI}
                    onChange={event => setIncludeAI(event.currentTarget.checked)}
                    size="md"
                  />
                  <Checkbox
                    label="💬 Slack 전송"
                    description={platform === 'all' && sendSlack
                      ? "플랫폼별 메시지 발송 (총 2개)"
                      : "완성된 리포트를 Slack으로 전송"}
                    checked={sendSlack}
                    onChange={event => setSendSlack(event.currentTarget.checked)}
                    size="md"
                  />
                  <Checkbox
                    label="🧪 테스트 모드"
                    description="테스트용 Slack 채널로 전송"
                    checked={isTestMode}
                    onChange={event => setIsTestMode(event.currentTarget.checked)}
                    size="md"
                  />
                </Group>
              </Stack>
            </Card>

            <Card withBorder p="lg" radius="md" style={{ backgroundColor: 'rgba(34, 197, 94, 0.05)', borderColor: 'rgba(34, 197, 94, 0.2)' }}>
              <form onSubmit={handleDailyGenerate}>
                <Stack gap="lg">
                  <div>
                    <Text fw={600} size="lg" c="green.6">📅 일간 리포트 생성</Text>
                    <Text size="sm" c="dimmed">특정 날짜를 지정하지 않으면 어제 날짜로 생성됩니다.</Text>
                  </div>

                  <TextInput
                    label="대상 날짜"
                    description="YYYY-MM-DD 형식"
                    placeholder="예: 2024-01-15"
                    value={targetDate}
                    onChange={event => setTargetDate(event.currentTarget.value)}
                    size="md"
                  />

                  <Group grow>
                    <Button
                      type="submit"
                      loading={loading}
                      color="green"
                      size="md"
                      leftSection="🚀"
                      disabled={status === 'running'}
                    >
                      {loading ? '생성 중...' : '일간 리포트 생성'}
                    </Button>

                    {logs.length > 0 && (
                      <Button
                        variant="light"
                        color="gray"
                        size="md"
                        leftSection="🗑️"
                        onClick={clearLogs}
                        disabled={status === 'running'}
                      >
                        로그 지우기
                      </Button>
                    )}
                  </Group>

                  {status !== 'idle' && (
                    <Group justify="space-between" align="center">
                      <Badge color={getStatusInfo(status).color} size="lg" leftSection={getStatusInfo(status).icon}>
                        {getStatusInfo(status).text}
                      </Badge>
                    </Group>
                  )}

                  {logs.length > 0 && (
                    <Card withBorder radius="md" p="md" style={{ backgroundColor: 'rgba(0, 0, 0, 0.02)' }}>
                      <Group justify="space-between" align="center" mb="md">
                        <Text fw={600} size="sm" c="dimmed">📋 실행 로그</Text>
                        <Badge variant="light" color="gray" size="sm">
                          {logs.length}개 항목
                        </Badge>
                      </Group>
                      <Divider mb="sm" />
                      <ScrollArea h={200} type="auto">
                        <Stack gap="xs">
                          {logs.map((log, index) => (
                            <Group key={index} gap="xs" align="flex-start" wrap="nowrap">
                              <Text
                                size="xs"
                                c={log.type === 'error' ? 'red' : log.type === 'success' ? 'green' : 'blue'}
                                style={{ minWidth: '60px' }}
                              >
                                {new Date(log.timestamp).toLocaleTimeString()}
                              </Text>
                              <Text
                                size="sm"
                                c={log.type === 'error' ? 'red.7' : log.type === 'success' ? 'green.7' : 'white'}
                                style={{ wordBreak: 'break-word', flex: 1 }}
                              >
                                {log.message}
                              </Text>
                            </Group>
                          ))}
                          <div ref={logsEndRef} />
                        </Stack>
                      </ScrollArea>
                    </Card>
                  )}
                </Stack>
              </form>
            </Card>
          </Stack>
        </Card>

        <Card withBorder p="md" style={{ backgroundColor: 'rgba(59, 130, 246, 0.03)', borderColor: 'rgba(59, 130, 246, 0.1)' }}>
          <Stack gap="xs">
            <Text size="sm" fw={500} c="blue.6">💡 사용 가이드</Text>
            <Text size="xs" c="dimmed">
              • 전체 플랫폼 선택 시 Android와 iOS 각각 리포트가 생성되며, Slack 메시지도 플랫폼별로 발송됩니다 (총 2개).
            </Text>
            <Text size="xs" c="dimmed">
              • 테스트 모드를 활성화하면 테스트용 Slack 채널로 알림이 전송됩니다.
            </Text>
            <Text size="xs" c="dimmed">
              • 날짜를 비워두면 기본값(어제)으로 자동 처리됩니다.
            </Text>
          </Stack>
        </Card>
      </Stack>
    </div>
  )
}
