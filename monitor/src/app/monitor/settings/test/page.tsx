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

      <Card withBorder radius="lg" p="lg" mt="md">
        <Stack gap="lg">
          {/* 리포트 타입 선택 */}
          <div>
            <Text fw={500} mb="xs">리포트 타입</Text>
            <SegmentedControl
              value={reportType}
              onChange={(value) => setReportType(value as 'daily' | 'weekly')}
              data={[
                { label: '일간 리포트', value: 'daily' },
                { label: '주간 리포트', value: 'weekly' }
              ]}
            />
          </div>

          {/* 공통 설정 */}
          <Group wrap="wrap" gap="sm" align="flex-end">
            <Select
              label="플랫폼"
              data={[
                { value: 'all', label: '전체' },
                { value: 'android', label: 'Android' },
                { value: 'ios', label: 'iOS' }
              ]}
              value={platform}
              onChange={(val) => setPlatform((val as Platform | 'all') ?? 'all')}
              w={140}
            />
            <Checkbox
              label="AI 분석 포함"
              checked={includeAI}
              onChange={(e) => setIncludeAI(e.currentTarget.checked)}
            />
            <Checkbox
              label="Slack 전송"
              checked={sendSlack}
              onChange={(e) => setSendSlack(e.currentTarget.checked)}
            />
            <Checkbox
              label="🧪 테스트 모드 (테스트용 Slack 채널로 전송)"
              checked={isTestMode}
              onChange={(e) => setIsTestMode(e.currentTarget.checked)}
            />
          </Group>

          {/* 일간 리포트 전용 설정 */}
          {reportType === 'daily' && (
            <form onSubmit={handleDailyGenerate}>
              <Stack gap="sm">
                <Group wrap="wrap" gap="sm" align="flex-end">
                  <TextInput
                    label="대상 날짜 (선택사항)"
                    placeholder="YYYY-MM-DD (예: 2024-01-15)"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.currentTarget.value)}
                    w={200}
                  />
                  <Button type="submit" loading={loading} color="green">
                    일간 리포트 생성
                  </Button>
                </Group>
                {message && (
                  <Text size="sm" c="dimmed">{message}</Text>
                )}
              </Stack>
            </form>
          )}

          {/* 주간 리포트 전용 설정 */}
          {reportType === 'weekly' && (
            <form onSubmit={handleWeeklyGenerate}>
              <Stack gap="sm">
                <div>
                  <Text fw={500} mb="xs">날짜 지정 방식</Text>
                  <SegmentedControl
                    value={dateMode}
                    onChange={(value) => setDateMode(value as 'week' | 'range')}
                    data={[
                      { label: '주차 지정', value: 'week' },
                      { label: '기간 지정', value: 'range' }
                    ]}
                  />
                </div>

                <Group wrap="wrap" gap="sm" align="flex-end">
                  {dateMode === 'week' ? (
                    <TextInput
                      label="대상 주차 (선택사항)"
                      placeholder="YYYY-Www (예: 2024-W03)"
                      value={targetWeek}
                      onChange={(e) => setTargetWeek(e.currentTarget.value)}
                      w={200}
                    />
                  ) : (
                    <>
                      <TextInput
                        label="시작 날짜 (선택사항)"
                        placeholder="YYYY-MM-DD"
                        value={startDate}
                        onChange={(e) => setStartDate(e.currentTarget.value)}
                        w={160}
                      />
                      <TextInput
                        label="종료 날짜 (선택사항)"
                        placeholder="YYYY-MM-DD"
                        value={endDate}
                        onChange={(e) => setEndDate(e.currentTarget.value)}
                        w={160}
                      />
                    </>
                  )}
                  <Button type="submit" loading={loading} color="green">
                    주간 리포트 생성
                  </Button>
                </Group>
                {message && (
                  <Text size="sm" c="dimmed">{message}</Text>
                )}
              </Stack>
            </form>
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