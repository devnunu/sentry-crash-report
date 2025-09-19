'use client'

import React, { useState } from 'react'
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
  Title 
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
  
  // 일간 리포트 전용 상태
  const [targetDate, setTargetDate] = useState('')
  
  // 주간 리포트 전용 상태
  const [targetWeek, setTargetWeek] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [dateMode, setDateMode] = useState<'week' | 'range'>('week')

  // 일간 리포트 생성
  const handleDailyGenerate = async (e: React.FormEvent) => {
    e.preventDefault()
    
    setLoading(true)
    setMessage('')
    
    try {
      const request: GenerateDailyReportRequest = {
        targetDate: targetDate || undefined,
        sendSlack,
        includeAI,
        isTestMode,
        platform: platform === 'all' ? undefined : platform as Platform
      }
      
      const response = await fetch('/api/reports/daily/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
      })
      
      const result: ApiResponse<{ message: string }> = await response.json()
      
      if (!result.success) {
        throw new Error(result.error || '리포트 생성에 실패했습니다')
      }
      
      const msg = result.data?.message || '리포트 생성됨'
      setMessage(`✅ ${msg}`)
      notifications.show({ color: 'green', message: `일간 리포트: ${msg}` })
      
      // 2초 후 메시지 초기화
      setTimeout(() => {
        setMessage('')
      }, 3000)
      
    } catch (err) {
      const m = err instanceof Error ? err.message : '알 수 없는 오류'
      setMessage(`❌ ${m}`)
      notifications.show({ color: 'red', message: `리포트 생성 실패: ${m}` })
    } finally {
      setLoading(false)
    }
  }

  // 주간 리포트 생성
  const handleWeeklyGenerate = async (e: React.FormEvent) => {
    e.preventDefault()
    
    setLoading(true)
    setMessage('')
    
    try {
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
      
      const response = await fetch('/api/reports/weekly/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
      })
      
      const result: ApiResponse<{ message: string }> = await response.json()
      
      if (!result.success) {
        throw new Error(result.error || '리포트 생성에 실패했습니다')
      }
      
      const msg = result.data?.message || '리포트 생성됨'
      setMessage(`✅ ${msg}`)
      notifications.show({ color: 'green', message: `주간 리포트: ${msg}` })
      
      // 2초 후 메시지 초기화
      setTimeout(() => {
        setMessage('')
      }, 3000)
      
    } catch (err) {
      const m = err instanceof Error ? err.message : '알 수 없는 오류'
      setMessage(`❌ ${m}`)
      notifications.show({ color: 'red', message: `리포트 생성 실패: ${m}` })
    } finally {
      setLoading(false)
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
                  
                  <Group grow>
                    <TextInput
                      label="대상 날짜"
                      description="비워두면 어제 날짜로 자동 설정됩니다"
                      placeholder="YYYY-MM-DD (예: 2024-01-15)"
                      value={targetDate}
                      onChange={(e) => setTargetDate(e.currentTarget.value)}
                      size="md"
                    />
                    <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                      <Button 
                        type="submit" 
                        loading={loading} 
                        color="green"
                        size="md"
                        leftSection="🚀"
                        fullWidth
                        style={{ minHeight: 42 }}
                      >
                        {loading ? '생성 중...' : '일간 리포트 생성'}
                      </Button>
                    </div>
                  </Group>
                  
                  {message && (
                    <Card withBorder p="md" style={{ 
                      backgroundColor: message.includes('✅') ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                      borderColor: message.includes('✅') ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'
                    }}>
                      <Text size="sm" fw={500}>{message}</Text>
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
                  
                  <Button 
                    type="submit" 
                    loading={loading} 
                    color="blue"
                    size="md"
                    leftSection="🚀"
                    fullWidth
                  >
                    {loading ? '생성 중...' : '주간 리포트 생성'}
                  </Button>
                  
                  {message && (
                    <Card withBorder p="md" style={{ 
                      backgroundColor: message.includes('✅') ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                      borderColor: message.includes('✅') ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'
                    }}>
                      <Text size="sm" fw={500}>{message}</Text>
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