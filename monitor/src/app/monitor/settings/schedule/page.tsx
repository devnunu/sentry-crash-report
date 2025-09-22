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
  const [dailyScheduleDays, setDailyScheduleDays] = useState<WeekDay[]>(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
  const [dailySlackDays, setDailySlackDays] = useState<WeekDay[]>(['tue', 'wed', 'thu', 'fri'])
  const [dailyScheduleTime, setDailyScheduleTime] = useState('09:00')
  const [dailyTestMode, setDailyTestMode] = useState(false)
  
  // 주간 리포트 설정
  const [weeklyAutoEnabled, setWeeklyAutoEnabled] = useState(false)
  const [weeklyAiEnabled, setWeeklyAiEnabled] = useState(true)
  const [weeklyScheduleDays, setWeeklyScheduleDays] = useState<WeekDay[]>(['mon'])
  const [weeklySlackDays, setWeeklySlackDays] = useState<WeekDay[]>(['mon'])
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
        setDailyScheduleDays(settings.schedule_days || ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
        setDailySlackDays(settings.slack_days || ['tue', 'wed', 'thu', 'fri'])
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
        setWeeklySlackDays(settings.slack_days || ['mon'])
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
    const slackDays = isDaily ? dailySlackDays : weeklySlackDays
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
          slack_days: slackDays,
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
  const currentSlackDays = reportType === 'daily' ? dailySlackDays : weeklySlackDays
  const currentScheduleTime = reportType === 'daily' ? dailyScheduleTime : weeklyScheduleTime
  const currentTestMode = reportType === 'daily' ? dailyTestMode : weeklyTestMode
  
  const setCurrentAutoEnabled = reportType === 'daily' ? setDailyAutoEnabled : setWeeklyAutoEnabled
  const setCurrentAiEnabled = reportType === 'daily' ? setDailyAiEnabled : setWeeklyAiEnabled
  const setCurrentScheduleDays = reportType === 'daily' ? setDailyScheduleDays : setWeeklyScheduleDays
  const setCurrentSlackDays = reportType === 'daily' ? setDailySlackDays : setWeeklySlackDays
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
            <Card withBorder p="lg" radius="md" style={{ backgroundColor: 'rgba(59, 130, 246, 0.05)', borderColor: 'rgba(59, 130, 246, 0.2)' }}>
              <Stack gap="lg">
                <div>
                  <Text fw={600} mb="md" c="blue.6">📅 리포트 생성 요일</Text>
                  <Text size="sm" c="dimmed" mb="xs">
                    {reportType === 'daily' ? '대시보드 데이터 제공을 위해 매일 생성하는 것을 권장합니다.' : '주간 리포트를 생성할 요일을 선택하세요.'}
                  </Text>
                  <Chip.Group multiple value={currentScheduleDays as any} onChange={(v) => setCurrentScheduleDays(v as any)}>
                    <Group gap={12} justify="center">
                      {weekDays.map(({ key, label }) => (
                        <Chip key={key} value={key} variant="filled" size="md">{label}요일</Chip>
                      ))}
                    </Group>
                  </Chip.Group>
                  {currentScheduleDays.length === 0 && (
                    <Card withBorder p="sm" mt="md" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
                      <Text size="sm" c="red" fw={500}>⚠️ 최소 1개 이상의 요일을 선택해주세요.</Text>
                    </Card>
                  )}
                </div>

                <div>
                  <Text fw={600} mb="md" c="green.6">📤 슬랙 전송 요일</Text>
                  <Text size="sm" c="dimmed" mb="xs">
                    {reportType === 'daily' 
                      ? '슬랙으로 알림을 받을 요일을 선택하세요. (토일월 제외 권장)' 
                      : '주간 리포트를 슬랙으로 전송할 요일을 선택하세요.'}
                  </Text>
                  <Chip.Group multiple value={currentSlackDays as any} onChange={(v) => setCurrentSlackDays(v as any)}>
                    <Group gap={12} justify="center">
                      {weekDays.map(({ key, label }) => (
                        <Chip key={`slack-${key}`} value={key} variant="light" size="md" color="green">{label}요일</Chip>
                      ))}
                    </Group>
                  </Chip.Group>
                  <Text size="xs" c="dimmed" mt="xs">
                    💡 슬랙 전송 없이 리포트만 생성하려면 모든 요일을 해제하세요.
                  </Text>
                </div>
                
                <div>
                  <Text fw={600} mb="md" c="blue.6">🕐 실행 시간</Text>
                  <Group align="flex-end">
                    <TextInput 
                      type="time" 
                      value={currentScheduleTime} 
                      onChange={(e) => setCurrentScheduleTime(e.currentTarget.value)} 
                      size="md"
                      style={{ minWidth: 140 }}
                      label="시간 (24시간 형식)"
                    />
                    <Text size="sm" c="dimmed" style={{ marginBottom: 8 }}>
                      {validateTimeFormat(currentScheduleTime) ? (
                        <span style={{ color: 'var(--mantine-color-blue-6)' }}>✅ {formatTimeKorean(currentScheduleTime)} (KST)</span>
                      ) : (
                        <span style={{ color: 'var(--mantine-color-red-6)' }}>❌ 올바른 시간 형식이 아닙니다</span>
                      )}
                    </Text>
                  </Group>
                </div>
              </Stack>
            </Card>
          )}

          {/* 저장 버튼 */}
          <Group justify="space-between" align="center">
            <Button 
              onClick={handleSettingsUpdate} 
              loading={loading} 
              disabled={(currentAutoEnabled && currentScheduleDays.length === 0) || !validateTimeFormat(currentScheduleTime)} 
              color="green"
              size="md"
              leftSection="💾"
              style={{ minWidth: 200 }}
            >
              {loading ? '저장 중...' : `${reportType === 'daily' ? '일간' : '주간'} 리포트 설정 저장`}
            </Button>
            
            {message && (
              <Card withBorder p="md" style={{ 
                backgroundColor: message.includes('✅') ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                borderColor: message.includes('✅') ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'
              }}>
                <Text size="sm" fw={500}>{message}</Text>
              </Card>
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