'use client'

import React, { useState, useRef, useEffect } from 'react'
import {
  Button,
  Card,
  Checkbox,
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  ScrollArea,
  Badge,
  Divider
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import type {
  GenerateDailyReportRequest,
  GenerateWeeklyReportRequest,
  Platform
} from '@/lib/reports/types'

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

interface LogEntry {
  type: 'log' | 'error' | 'success'
  message: string
  timestamp: string
  data?: any
}

type GenerationStatus = 'idle' | 'running' | 'completed' | 'error'

export default function TestExecutionPage() {
  // 리포트 타입 선택
  const [reportType, setReportType] = useState<'daily' | 'weekly'>('daily')
  
  // 공통 상태
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [includeAI, setIncludeAI] = useState(true)
  const [sendSlack, setSendSlack] = useState(true)
  const [isTestMode, setIsTestMode] = useState(false)
  const [platform, setPlatform] = useState<Platform | 'all'>('all')

  // 로그 및 진행 상태 관리
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [status, setStatus] = useState<GenerationStatus>('idle')
  const eventSourceRef = useRef<EventSource | null>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)
  
  // 일간 리포트 전용 상태
  const [targetDate, setTargetDate] = useState('')
  
  // 주간 리포트 전용 상태
  const [targetWeek, setTargetWeek] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [dateMode, setDateMode] = useState<'week' | 'range'>('week')

  // 로그 자동 스크롤
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs])

  // EventSource 정리
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [])

  // SSE 연결 및 로그 수신
  const startStreaming = (endpoint: string, requestData: any) => {
    setLogs([])
    setStatus('running')
    setLoading(true)
    setMessage('')

    // 기존 연결 정리
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    // POST 요청으로 스트리밍 시작
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData)
    }).then(response => {
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

            for (const line of lines) {
              if (line.startsWith('data: ')) {
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
                    notifications.show({
                      color: 'green',
                      message: '리포트 생성이 완료되었습니다!'
                    })
                  } else if (data.type === 'error') {
                    setStatus('error')
                    setLoading(false)
                  }
                } catch (parseError) {
                  console.warn('Failed to parse SSE data:', parseError)
                }
              }
            }
          }
        } catch (streamError) {
          console.error('Stream reading error:', streamError)
          setStatus('error')
          setLoading(false)
          setLogs(prev => [...prev, {
            type: 'error',
            message: `스트림 오류: ${streamError instanceof Error ? streamError.message : String(streamError)}`,
            timestamp: new Date().toISOString()
          }])
        }
      }

      readStream()
    }).catch(error => {
      console.error('Fetch error:', error)
      setStatus('error')
      setLoading(false)
      setLogs(prev => [...prev, {
        type: 'error',
        message: `연결 오류: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date().toISOString()
      }])
    })
  }

  // 일간 리포트 생성
  const handleDailyGenerate = async (e: React.FormEvent) => {
    e.preventDefault()

    const request: GenerateDailyReportRequest = {
      targetDate: targetDate || undefined,
      sendSlack,
      includeAI,
      isTestMode,
      platform: platform === 'all' ? undefined : platform as Platform
    }

    startStreaming('/api/reports/daily/generate-stream', request)
  }

  // 주간 리포트 생성
  const handleWeeklyGenerate = async (e: React.FormEvent) => {
    e.preventDefault()

    const request: GenerateWeeklyReportRequest = {
      sendSlack,
      includeAI,
      isTestMode,
      platform: platform === 'all' ? undefined : platform as Platform,
      ...(dateMode === 'week'
        ? { targetWeek: targetWeek || undefined }
        : { startDate: startDate || undefined, endDate: endDate || undefined }
      )
    }

    startStreaming('/api/reports/weekly/generate-stream', request)
  }

  // 로그 초기화
  const clearLogs = () => {
    setLogs([])
    setStatus('idle')
    setMessage('')
  }

  // 상태에 따른 UI 텍스트
  const getStatusInfo = () => {
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

  return (
    <div className="container">
      <Group justify="space-between" align="flex-start" mb="sm">
        <div>
          <Title order={2}>🧪 테스트 실행</Title>
          <Text c="dimmed" size="sm">
            일간 및 주간 리포트를 수동으로 생성하고 테스트할 수 있습니다.
          </Text>
        </div>
      </Group>

      <Card withBorder radius="lg" p="xl" mt="md" style={{ background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.05) 0%, rgba(168, 85, 247, 0.05) 100%)', borderColor: 'rgba(99, 102, 241, 0.2)' }}>
        <Stack gap="xl">
          {/* 리포트 타입 선택 */}
          <div>
            <Group mb="md">
              <Text fw={600} size="lg" c="indigo.6">📊 리포트 타입 선택</Text>
            </Group>
            <SegmentedControl
              value={reportType}
              onChange={(value) => setReportType(value as 'daily' | 'weekly')}
              data={[
                { label: '📅 일간 리포트', value: 'daily' },
                { label: '📆 주간 리포트', value: 'weekly' }
              ]}
              size="md"
              fullWidth
            />
          </div>

          {/* 공통 설정 */}
          <Card withBorder p="lg" radius="md" style={{ backgroundColor: 'rgba(255, 255, 255, 0.03)' }}>
            <Text fw={600} mb="md" c="indigo.5">⚙️ 공통 설정</Text>
            <Stack gap="md">
              <Select
                label="대상 플랫폼"
                description="리포트를 생성할 플랫폼을 선택하세요"
                data={[
                  { value: 'all', label: '🌐 전체 플랫폼' },
                  { value: 'android', label: '🤖 Android' },
                  { value: 'ios', label: '🍎 iOS' }
                ]}
                value={platform}
                onChange={(val) => setPlatform((val as Platform | 'all') ?? 'all')}
                size="md"
              />
              <Group grow>
                <Checkbox
                  label="🤖 AI 분석 포함"
                  description="OpenAI를 활용한 이슈 분석 포함"
                  checked={includeAI}
                  onChange={(e) => setIncludeAI(e.currentTarget.checked)}
                  size="md"
                />
                <Checkbox
                  label="💬 Slack 전송"
                  description="완성된 리포트를 Slack으로 전송"
                  checked={sendSlack}
                  onChange={(e) => setSendSlack(e.currentTarget.checked)}
                  size="md"
                />
                <Checkbox
                  label="🧪 테스트 모드"
                  description="테스트용 Slack 채널로 전송"
                  checked={isTestMode}
                  onChange={(e) => setIsTestMode(e.currentTarget.checked)}
                  size="md"
                />
              </Group>
            </Stack>
          </Card>

          {/* 일간 리포트 전용 설정 */}
          {reportType === 'daily' && (
            <Card withBorder p="lg" radius="md" style={{ backgroundColor: 'rgba(34, 197, 94, 0.05)', borderColor: 'rgba(34, 197, 94, 0.2)' }}>
              <form onSubmit={handleDailyGenerate}>
                <Stack gap="lg">
                  <Group justify="space-between" align="center">
                    <div>
                      <Text fw={600} size="lg" c="green.6">📅 일간 리포트 생성</Text>
                      <Text size="sm" c="dimmed">특정 날짜의 일간 리포트를 생성합니다</Text>
                    </div>
                  </Group>
                  
                  <TextInput
                    label="대상 날짜"
                    description="비워두면 어제 날짜로 자동 설정됩니다"
                    placeholder="YYYY-MM-DD (예: 2024-01-15)"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.currentTarget.value)}
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

                  {/* 상태 표시 */}
                  {status !== 'idle' && (
                    <Group justify="space-between" align="center">
                      <Badge
                        color={getStatusInfo().color}
                        size="lg"
                        leftSection={getStatusInfo().icon}
                      >
                        {getStatusInfo().text}
                      </Badge>
                      {status === 'completed' && logs.length > 0 && (
                        <Text size="sm" c="green.6" fw={500}>
                          {logs.filter(log => log.type === 'success').length > 0 ? '모든 작업이 완료되었습니다!' : ''}
                        </Text>
                      )}
                    </Group>
                  )}

                  {message && (
                    <Card withBorder p="md" style={{
                      backgroundColor: message.includes('✅') ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                      borderColor: message.includes('✅') ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'
                    }}>
                      <Text size="sm" fw={500}>{message}</Text>
                    </Card>
                  )}

                  {/* 실시간 로그 표시 */}
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
          )}

          {/* 주간 리포트 전용 설정 */}
          {reportType === 'weekly' && (
            <Card withBorder p="lg" radius="md" style={{ backgroundColor: 'rgba(59, 130, 246, 0.05)', borderColor: 'rgba(59, 130, 246, 0.2)' }}>
              <form onSubmit={handleWeeklyGenerate}>
                <Stack gap="lg">
                  <Group justify="space-between" align="center">
                    <div>
                      <Text fw={600} size="lg" c="blue.6">📆 주간 리포트 생성</Text>
                      <Text size="sm" c="dimmed">특정 주차 또는 기간의 주간 리포트를 생성합니다</Text>
                    </div>
                  </Group>
                  
                  <div>
                    <Text fw={500} mb="md" c="blue.5">📅 날짜 지정 방식</Text>
                    <SegmentedControl
                      value={dateMode}
                      onChange={(value) => setDateMode(value as 'week' | 'range')}
                      data={[
                        { label: '🗓️ 주차 지정', value: 'week' },
                        { label: '📊 기간 지정', value: 'range' }
                      ]}
                      size="md"
                      fullWidth
                    />
                  </div>

                  <Group grow>
                    {dateMode === 'week' ? (
                      <TextInput
                        label="대상 주차"
                        description="비워두면 지난주로 자동 설정됩니다"
                        placeholder="YYYY-Www (예: 2024-W03)"
                        value={targetWeek}
                        onChange={(e) => setTargetWeek(e.currentTarget.value)}
                        size="md"
                      />
                    ) : (
                      <Group grow>
                        <TextInput
                          label="시작 날짜"
                          description="기간의 시작일"
                          placeholder="YYYY-MM-DD"
                          value={startDate}
                          onChange={(e) => setStartDate(e.currentTarget.value)}
                          size="md"
                        />
                        <TextInput
                          label="종료 날짜"
                          description="기간의 종료일"
                          placeholder="YYYY-MM-DD"
                          value={endDate}
                          onChange={(e) => setEndDate(e.currentTarget.value)}
                          size="md"
                        />
                      </Group>
                    )}
                  </Group>
                  
                  <Group grow>
                    <Button
                      type="submit"
                      loading={loading}
                      color="blue"
                      size="md"
                      leftSection="🚀"
                      disabled={status === 'running'}
                    >
                      {loading ? '생성 중...' : '주간 리포트 생성'}
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

                  {/* 상태 표시 */}
                  {status !== 'idle' && (
                    <Group justify="space-between" align="center">
                      <Badge
                        color={getStatusInfo().color}
                        size="lg"
                        leftSection={getStatusInfo().icon}
                      >
                        {getStatusInfo().text}
                      </Badge>
                      {status === 'completed' && logs.length > 0 && (
                        <Text size="sm" c="blue.6" fw={500}>
                          {logs.filter(log => log.type === 'success').length > 0 ? '모든 작업이 완료되었습니다!' : ''}
                        </Text>
                      )}
                    </Group>
                  )}

                  {message && (
                    <Card withBorder p="md" style={{
                      backgroundColor: message.includes('✅') ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                      borderColor: message.includes('✅') ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'
                    }}>
                      <Text size="sm" fw={500}>{message}</Text>
                    </Card>
                  )}

                  {/* 실시간 로그 표시 */}
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
          )}
        </Stack>
      </Card>

      {/* 도움말 */}
      <div className="muted" style={{ marginTop: '20px', fontSize: '12px' }}>
        💡 <strong>참고:</strong> 테스트 모드를 활성화하면 테스트용 Slack 채널로 알림이 전송됩니다.
        날짜를 지정하지 않으면 기본값(어제/지난주)으로 리포트가 생성됩니다.
      </div>
    </div>
  )
}