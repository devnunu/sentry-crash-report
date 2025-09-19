'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { 
  Button, 
  Card, 
  Checkbox, 
  Chip, 
  Group, 
  SegmentedControl, 
  Stack, 
  Text, 
  TextInput, 
  Title 
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { validateTimeFormat, formatTimeKorean } from '@/lib/utils'
import type { 
  ReportSettings, 
  WeekDay
} from '@/lib/reports/types'

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

interface CronStatus {
  currentTime?: { time: string; day: string }
  dailyReport?: {
    shouldRunToday: boolean
    timeMatch: boolean
    scheduleTime: string
  }
  weeklyReport?: {
    shouldRunToday: boolean
    timeMatch: boolean
    scheduleTime: string
  }
}

export default function ScheduleSettingsPage() {
  // 리포트 타입 선택
  const [reportType, setReportType] = useState<'daily' | 'weekly'>('daily')
  
  // 공통 상태
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [cronLoading, setCronLoading] = useState(false)
  const [cronStatus, setCronStatus] = useState<CronStatus | null>(null)
  
  // 일간 리포트 설정
  const [dailyAutoEnabled, setDailyAutoEnabled] = useState(false)
  const [dailyAiEnabled, setDailyAiEnabled] = useState(true)
  const [dailyScheduleDays, setDailyScheduleDays] = useState<WeekDay[]>(['mon', 'tue', 'wed', 'thu', 'fri'])
  const [dailyScheduleTime, setDailyScheduleTime] = useState('09:00')
  const [dailyTestMode, setDailyTestMode] = useState(false)
  
  // 주간 리포트 설정
  const [weeklyAutoEnabled, setWeeklyAutoEnabled] = useState(false)
  const [weeklyAiEnabled, setWeeklyAiEnabled] = useState(true)
  const [weeklyScheduleDays, setWeeklyScheduleDays] = useState<WeekDay[]>(['mon'])
  const [weeklyScheduleTime, setWeeklyScheduleTime] = useState('09:00')
  const [weeklyTestMode, setWeeklyTestMode] = useState(false)

  // 요일 옵션
  const weekDays = [
    { key: 'mon' as WeekDay, label: '월' },
    { key: 'tue' as WeekDay, label: '화' },
    { key: 'wed' as WeekDay, label: '수' },
    { key: 'thu' as WeekDay, label: '목' },
    { key: 'fri' as WeekDay, label: '금' },
    { key: 'sat' as WeekDay, label: '토' },
    { key: 'sun' as WeekDay, label: '일' },
  ]

  // 설정 조회
  const fetchSettings = useCallback(async () => {
    try {
      // 일간 리포트 설정 조회
      const dailyResponse = await fetch('/api/reports/daily/settings')
      const dailyResult: ApiResponse<{ settings: ReportSettings }> = await dailyResponse.json()
      
      if (dailyResult.success && dailyResult.data) {
        const settings = dailyResult.data.settings
        setDailyAutoEnabled(settings.auto_enabled)
        setDailyAiEnabled(settings.ai_enabled)
        setDailyScheduleDays(settings.schedule_days || ['mon', 'tue', 'wed', 'thu', 'fri'])
        setDailyScheduleTime(settings.schedule_time || '09:00')
        setDailyTestMode(settings.is_test_mode || false)
      }

      // 주간 리포트 설정 조회
      const weeklyResponse = await fetch('/api/reports/weekly/settings')
      const weeklyResult: ApiResponse<{ settings: ReportSettings }> = await weeklyResponse.json()
      
      if (weeklyResult.success && weeklyResult.data) {
        const settings = weeklyResult.data.settings
        setWeeklyAutoEnabled(settings.auto_enabled)
        setWeeklyAiEnabled(settings.ai_enabled)
        setWeeklyScheduleDays(settings.schedule_days || ['mon'])
        setWeeklyScheduleTime(settings.schedule_time || '09:00')
        setWeeklyTestMode(settings.is_test_mode || false)
      }
    } catch (err) {
      console.error('Failed to fetch settings:', err)
    }
  }, [])

  // Cron 상태 조회
  const fetchCronStatus = useCallback(async () => {
    setCronLoading(true)
    try {
      const res = await fetch('/api/debug/cron-status')
      const data = await res.json()
      if (data?.success) setCronStatus(data.data)
    } catch (e) {
      // noop
    } finally {
      setCronLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSettings()
    fetchCronStatus()
    
    // Cron 상태 주기적 조회
    const interval = setInterval(fetchCronStatus, 60000)
    return () => clearInterval(interval)
  }, [fetchSettings, fetchCronStatus])

  // 설정 업데이트
  const handleSettingsUpdate = async () => {
    setLoading(true)
    setMessage('')
    
    const isDaily = reportType === 'daily'
    const autoEnabled = isDaily ? dailyAutoEnabled : weeklyAutoEnabled
    const aiEnabled = isDaily ? dailyAiEnabled : weeklyAiEnabled
    const scheduleDays = isDaily ? dailyScheduleDays : weeklyScheduleDays
    const scheduleTime = isDaily ? dailyScheduleTime : weeklyScheduleTime
    const testMode = isDaily ? dailyTestMode : weeklyTestMode
    
    // 시간 형식 검증
    if (!validateTimeFormat(scheduleTime)) {
      setMessage('❌ 올바른 시간 형식을 입력해주세요 (예: 09:00)')
      setLoading(false)
      setTimeout(() => setMessage(''), 5000)
      return
    }

    try {
      // 설정 저장
      const settingsResponse = await fetch(`/api/reports/${reportType}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auto_enabled: autoEnabled,
          ai_enabled: aiEnabled,
          schedule_days: scheduleDays,
          schedule_time: scheduleTime,
          is_test_mode: testMode
        })
      })
      
      const settingsResult: ApiResponse<{ message: string }> = await settingsResponse.json()
      
      if (!settingsResult.success) {
        throw new Error(settingsResult.error || '설정 업데이트 실패')
      }

      // QStash 스케줄 업데이트 (자동 스케줄이 활성화된 경우)
      if (autoEnabled) {
        const scheduleResponse = await fetch('/api/schedule/manage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reportType,
            scheduleDays,
            scheduleTime
          })
        })

        const scheduleResult = await scheduleResponse.json()
        
        if (!scheduleResult.success) {
          console.warn('QStash 스케줄 업데이트 실패:', scheduleResult.error)
          // QStash 실패해도 설정 저장은 성공으로 처리
        }
      }

      const msg = `${isDaily ? '일간' : '주간'} 리포트 설정이 저장되었습니다`
      setMessage(`✅ ${msg}`)
      notifications.show({ color: 'green', message: msg })
      
      // 2초 후 메시지 초기화
      setTimeout(() => setMessage(''), 3000)
      
    } catch (err) {
      const m = err instanceof Error ? err.message : '알 수 없는 오류'
      setMessage(`❌ ${m}`)
      notifications.show({ color: 'red', message: `설정 저장 실패: ${m}` })
    } finally {
      setLoading(false)
    }
  }

  // 현재 선택된 리포트 타입의 설정값들
  const currentAutoEnabled = reportType === 'daily' ? dailyAutoEnabled : weeklyAutoEnabled
  const currentAiEnabled = reportType === 'daily' ? dailyAiEnabled : weeklyAiEnabled
  const currentScheduleDays = reportType === 'daily' ? dailyScheduleDays : weeklyScheduleDays
  const currentScheduleTime = reportType === 'daily' ? dailyScheduleTime : weeklyScheduleTime
  const currentTestMode = reportType === 'daily' ? dailyTestMode : weeklyTestMode
  
  const setCurrentAutoEnabled = reportType === 'daily' ? setDailyAutoEnabled : setWeeklyAutoEnabled
  const setCurrentAiEnabled = reportType === 'daily' ? setDailyAiEnabled : setWeeklyAiEnabled
  const setCurrentScheduleDays = reportType === 'daily' ? setDailyScheduleDays : setWeeklyScheduleDays
  const setCurrentScheduleTime = reportType === 'daily' ? setDailyScheduleTime : setWeeklyScheduleTime
  const setCurrentTestMode = reportType === 'daily' ? setDailyTestMode : setWeeklyTestMode

  return (
    <div className="container">
      <Group justify="space-between" align="flex-start" mb="sm">
        <div>
          <Title order={2}>⏰ 자동 스케줄 설정</Title>
          <Text c="dimmed" size="sm">
            일간 및 주간 리포트의 자동 실행 스케줄을 설정할 수 있습니다.
          </Text>
        </div>
      </Group>

      {/* 현재 스케줄 상태 */}
      <Card withBorder radius="lg" p="lg" mt="md">
        <Title order={4} mb="sm">📊 현재 스케줄 상태</Title>
        <Text c="dimmed" mb={12}>
          {cronLoading ? '스케줄 상태 불러오는 중…' : (
            cronStatus ? (
              `현재 시간(KST): ${cronStatus.currentTime?.time} (${String(cronStatus.currentTime?.day).toUpperCase()})`
            ) : '스케줄 상태 정보를 가져오지 못했습니다.'
          )}
        </Text>
        {cronStatus && (
          <Group gap="xl">
            <div>
              <Text fw={600} size="sm" mb={4}>일간 리포트</Text>
              <Text size="sm" c="dimmed">
                오늘 실행: {cronStatus.dailyReport?.shouldRunToday ? '예' : '아니오'} · 
                시간 일치: {cronStatus.dailyReport?.timeMatch ? '예' : '아니오'} · 
                설정: {cronStatus.dailyReport?.scheduleTime}
              </Text>
            </div>
            <div>
              <Text fw={600} size="sm" mb={4}>주간 리포트</Text>
              <Text size="sm" c="dimmed">
                오늘 실행: {cronStatus.weeklyReport?.shouldRunToday ? '예' : '아니오'} · 
                시간 일치: {cronStatus.weeklyReport?.timeMatch ? '예' : '아니오'} · 
                설정: {cronStatus.weeklyReport?.scheduleTime}
              </Text>
            </div>
          </Group>
        )}
      </Card>

      {/* 스케줄 설정 */}
      <Card withBorder radius="lg" p="lg" mt="md">
        <Stack gap="lg">
          {/* 리포트 타입 선택 */}
          <div>
            <Text fw={500} mb="xs">설정할 리포트 타입</Text>
            <SegmentedControl
              value={reportType}
              onChange={(value) => setReportType(value as 'daily' | 'weekly')}
              data={[
                { label: '일간 리포트', value: 'daily' },
                { label: '주간 리포트', value: 'weekly' }
              ]}
            />
          </div>

          {/* 기본 설정 */}
          <Group gap="lg">
            <Checkbox 
              label="자동 실행 활성화" 
              checked={currentAutoEnabled} 
              onChange={(e) => setCurrentAutoEnabled(e.currentTarget.checked)} 
            />
            <Checkbox 
              label="AI 분석 포함" 
              checked={currentAiEnabled} 
              onChange={(e) => setCurrentAiEnabled(e.currentTarget.checked)} 
            />
            <Checkbox 
              label="🧪 테스트 모드" 
              checked={currentTestMode} 
              onChange={(e) => setCurrentTestMode(e.currentTarget.checked)} 
            />
          </Group>

          {/* 스케줄 상세 설정 */}
          {currentAutoEnabled && (
            <div>
              <Text fw={600} size="sm" mb={6}>실행 요일 선택</Text>
              <Chip.Group multiple value={currentScheduleDays as any} onChange={(v) => setCurrentScheduleDays(v as any)}>
                <Group gap={8} wrap="wrap">
                  {weekDays.map(({ key, label }) => (
                    <Chip key={key} value={key} variant="filled">{label}</Chip>
                  ))}
                </Group>
              </Chip.Group>
              {currentScheduleDays.length === 0 && (
                <Text size="xs" c="red" mt={4}>최소 1개 이상의 요일을 선택해주세요.</Text>
              )}
              
              <div style={{ marginTop: 12 }}>
                <Text fw={600} size="sm" mb={6}>실행 시간</Text>
                <TextInput 
                  type="time" 
                  value={currentScheduleTime} 
                  onChange={(e) => setCurrentScheduleTime(e.currentTarget.value)} 
                  w={180} 
                />
                <Text size="xs" c="dimmed" ml={8} span>
                  {validateTimeFormat(currentScheduleTime) ? `${formatTimeKorean(currentScheduleTime)} (KST)` : '(KST 기준)'}
                </Text>
              </div>
            </div>
          )}

          {/* 저장 버튼 */}
          <Group align="center" gap="sm">
            <Button 
              onClick={handleSettingsUpdate} 
              loading={loading} 
              disabled={(currentAutoEnabled && currentScheduleDays.length === 0) || !validateTimeFormat(currentScheduleTime)} 
              variant="light"
            >
              {reportType === 'daily' ? '일간' : '주간'} 리포트 설정 저장
            </Button>
            {message && (
              <Text size="sm" c={message.startsWith('✅') ? 'green' : 'red'} fw={500}>{message}</Text>
            )}
          </Group>
        </Stack>
      </Card>

      {/* 도움말 */}
      <div className="muted" style={{ marginTop: '20px', fontSize: '12px' }}>
        💡 <strong>참고:</strong> 자동 스케줄은 QStash를 통해 관리되며, 설정된 요일과 시간에 자동으로 리포트가 생성됩니다.
        테스트 모드를 활성화하면 테스트용 Slack 채널로 알림이 전송됩니다.
      </div>
    </div>
  )
}