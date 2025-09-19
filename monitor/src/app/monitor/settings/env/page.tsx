'use client'

import { useState, useEffect } from 'react'
import { Container, Title, Paper, Stack, Group, Text, Badge, Alert, LoadingOverlay, Card, Divider } from '@mantine/core'
import { IconAlertCircle, IconCheck, IconX, IconEye, IconEyeOff } from '@tabler/icons-react'

interface EnvVariable {
  key: string
  value: string | undefined
  required: boolean
  category: string
  description: string
  isPublic?: boolean
}

const ENV_VARIABLES: EnvVariable[] = [
  // Supabase
  { key: 'NEXT_PUBLIC_SUPABASE_URL', value: undefined, required: true, category: 'Supabase', description: 'Supabase 프로젝트 URL', isPublic: true },
  { key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', value: undefined, required: true, category: 'Supabase', description: 'Supabase Anonymous Key', isPublic: true },
  { key: 'SUPABASE_SERVICE_ROLE_KEY', value: undefined, required: true, category: 'Supabase', description: 'Supabase Service Role Key' },
  
  // Sentry
  { key: 'SENTRY_AUTH_TOKEN', value: undefined, required: true, category: 'Sentry', description: 'Sentry 인증 토큰' },
  { key: 'SENTRY_ORG_SLUG', value: undefined, required: true, category: 'Sentry', description: 'Sentry 조직 슬러그' },
  
  // QStash
  { key: 'QSTASH_TOKEN', value: undefined, required: true, category: 'QStash', description: 'QStash 인증 토큰' },
  { key: 'QSTASH_CURRENT_SIGNING_KEY', value: undefined, required: true, category: 'QStash', description: 'QStash 현재 서명 키' },
  { key: 'QSTASH_NEXT_SIGNING_KEY', value: undefined, required: true, category: 'QStash', description: 'QStash 다음 서명 키' },
  
  // OpenAI
  { key: 'OPENAI_API_KEY', value: undefined, required: false, category: 'OpenAI', description: 'OpenAI API 키 (AI 분석용)' },
  
  // Slack
  { key: 'SLACK_TEST_WEBHOOK_URL', value: undefined, required: false, category: 'Slack', description: 'Slack 테스트 웹훅 URL' },
  
  // App URLs
  { key: 'APP_BASE_URL', value: undefined, required: false, category: 'App URLs', description: '앱 기본 URL' },
  { key: 'NEXT_PUBLIC_APP_URL', value: undefined, required: false, category: 'App URLs', description: '공개 앱 URL', isPublic: true },
  { key: 'VERCEL_URL', value: undefined, required: false, category: 'App URLs', description: 'Vercel 배포 URL' },
  
  // Others
  { key: 'NODE_ENV', value: undefined, required: true, category: 'System', description: 'Node.js 환경' },
  { key: 'CRON_SECRET', value: undefined, required: false, category: 'Security', description: 'Cron 작업 인증 시크릿' },
]

export default function EnvironmentVariablesPage() {
  const [envVars, setEnvVars] = useState<EnvVariable[]>([])
  const [loading, setLoading] = useState(true)
  const [showValues, setShowValues] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const fetchEnvVars = async () => {
      try {
        const response = await fetch('/api/admin/env-check')
        const data = await response.json()
        
        const updatedVars = ENV_VARIABLES.map(envVar => ({
          ...envVar,
          value: data[envVar.key]
        }))
        
        setEnvVars(updatedVars)
      } catch (error) {
        console.error('Failed to fetch environment variables:', error)
        setEnvVars(ENV_VARIABLES)
      } finally {
        setLoading(false)
      }
    }

    fetchEnvVars()
  }, [])

  const toggleShowValue = (key: string) => {
    setShowValues(prev => ({
      ...prev,
      [key]: !prev[key]
    }))
  }

  const getStatusColor = (envVar: EnvVariable) => {
    if (envVar.required && !envVar.value) return 'red'
    if (envVar.value) return 'green'
    return 'gray'
  }

  const getStatusIcon = (envVar: EnvVariable) => {
    if (envVar.required && !envVar.value) return <IconX size={16} />
    if (envVar.value) return <IconCheck size={16} />
    return null
  }

  const maskValue = (value: string | undefined, isVisible: boolean) => {
    if (!value) return 'Not set'
    if (isVisible) return value
    return '••••••••••••••••'
  }

  const categorizedVars = envVars.reduce((acc, envVar) => {
    if (!acc[envVar.category]) {
      acc[envVar.category] = []
    }
    acc[envVar.category].push(envVar)
    return acc
  }, {} as Record<string, EnvVariable[]>)

  const totalRequired = envVars.filter(v => v.required).length
  const setRequired = envVars.filter(v => v.required && v.value).length
  const totalOptional = envVars.filter(v => !v.required).length
  const setOptional = envVars.filter(v => !v.required && v.value).length

  return (
    <Container size="xl" py="md">
      <Stack gap="lg">
        <div>
          <Title order={2} mb="sm">환경 변수</Title>
          <Text c="dimmed">
            애플리케이션에서 사용하는 환경 변수들의 설정 상태를 확인할 수 있습니다.
          </Text>
        </div>

        <Paper p="md" withBorder>
          <LoadingOverlay visible={loading} />
          
          <Group justify="space-between" mb="md">
            <Text fw={500}>설정 현황</Text>
            <Group gap="md">
              <Badge color="blue" variant="light">
                필수: {setRequired}/{totalRequired}
              </Badge>
              <Badge color="gray" variant="light">
                선택: {setOptional}/{totalOptional}
              </Badge>
            </Group>
          </Group>

          {setRequired < totalRequired && (
            <Alert icon={<IconAlertCircle size={16} />} color="red" mb="md">
              {totalRequired - setRequired}개의 필수 환경 변수가 설정되지 않았습니다.
            </Alert>
          )}

          <Stack gap="lg">
            {Object.entries(categorizedVars).map(([category, vars]) => (
              <Card key={category} withBorder>
                <Text fw={600} mb="md">{category}</Text>
                <Stack gap="xs">
                  {vars.map((envVar) => (
                    <div key={envVar.key}>
                      <Group justify="space-between" align="flex-start">
                        <div style={{ flex: 1 }}>
                          <Group gap="xs" mb={4}>
                            <Text fw={500} size="sm">{envVar.key}</Text>
                            <Badge
                              size="xs"
                              color={getStatusColor(envVar)}
                              variant="light"
                              leftSection={getStatusIcon(envVar)}
                            >
                              {envVar.required ? '필수' : '선택'}
                            </Badge>
                            {envVar.isPublic && (
                              <Badge size="xs" color="blue" variant="outline">
                                Public
                              </Badge>
                            )}
                          </Group>
                          <Text size="xs" c="dimmed" mb={4}>
                            {envVar.description}
                          </Text>
                          <Group gap="xs">
                            <Text size="sm" ff="monospace" c={envVar.value ? 'blue' : 'red'}>
                              {maskValue(envVar.value, showValues[envVar.key] || envVar.isPublic || false)}
                            </Text>
                            {envVar.value && !envVar.isPublic && (
                              <button
                                onClick={() => toggleShowValue(envVar.key)}
                                style={{ 
                                  background: 'none', 
                                  border: 'none', 
                                  cursor: 'pointer',
                                  color: 'var(--mantine-color-dimmed)',
                                  padding: 0
                                }}
                              >
                                {showValues[envVar.key] ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                              </button>
                            )}
                          </Group>
                        </div>
                      </Group>
                      {vars.indexOf(envVar) < vars.length - 1 && <Divider mt="sm" />}
                    </div>
                  ))}
                </Stack>
              </Card>
            ))}
          </Stack>
        </Paper>
      </Stack>
    </Container>
  )
}