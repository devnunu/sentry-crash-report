'use client'

import React, { useState } from 'react'
import { 
  Card, 
  Group, 
  Text, 
  Title, 
  Stack, 
  TextInput,
  Button,
  Badge,
  Alert,
  Collapse,
  Divider,
  Code,
  List,
  Anchor
} from '@mantine/core'
import { 
  IconSearch, 
  IconAlertTriangle,
  IconChevronDown,
  IconChevronUp,
  IconExternalLink,
  IconBrain,
  IconTarget,
  IconBulb,
  IconCode,
  IconEye,
  IconClipboard
} from '@tabler/icons-react'
import { notifications } from '@mantine/notifications'

interface SentryIssueData {
  issueId: string
  shortId?: string
  title: string
  level: string
  status: string
  eventCount: number
  userCount: number
  firstSeen: string
  lastSeen: string
  sentryUrl: string
}

interface AIAnalysisResult {
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  category: string
  rootCause: string
  detailedAnalysis: string
  solutions: {
    immediate: string[]
    longTerm: string[]
    codeExample?: string
    monitoring?: string[]
    prevention?: string[]
  }
  references?: string[]
  detailedEvidence?: {
    stackTrace: string
    breadcrumbs: string
    eventGrouping: string
    analysisReasoning: string
    referenceData: string[]
  }
}

interface AnalysisResponse {
  issueInfo: SentryIssueData
  analysis: AIAnalysisResult
}

const getLevelColor = (level: string) => {
  switch (level?.toLowerCase()) {
    case 'fatal': return 'red'
    case 'error': return 'red'
    case 'warning': return 'yellow'
    case 'info': return 'blue'
    default: return 'gray'
  }
}

const getLevelIcon = (level: string) => {
  switch (level?.toLowerCase()) {
    case 'fatal': return '🔴'
    case 'error': return '🔴'
    case 'warning': return '🟡'
    case 'info': return '🔵'
    default: return '⚪'
  }
}

const getSeverityColor = (severity: string) => {
  switch (severity) {
    case 'CRITICAL': return 'red'
    case 'HIGH': return 'orange'
    case 'MEDIUM': return 'yellow'
    case 'LOW': return 'blue'
    default: return 'gray'
  }
}

const getSeverityIcon = (severity: string) => {
  switch (severity) {
    case 'CRITICAL': return '🚨'
    case 'HIGH': return '⚠️'
    case 'MEDIUM': return '⚠️'
    case 'LOW': return '💡'
    default: return '📋'
  }
}

const formatNumber = (num: number) => {
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}k`
  }
  return num.toString()
}

const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleString('ko-KR')
}

export default function SentryAnalysisPage() {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AnalysisResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showDetailedEvidence, setShowDetailedEvidence] = useState(false)

  const handleAnalyze = async () => {
    if (!input.trim()) {
      notifications.show({
        color: 'red',
        message: '이슈 ID를 입력해주세요'
      })
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch('/api/sentry/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: input.trim() })
      })

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.error || '분석에 실패했습니다')
      }

      setResult(data.data)
      notifications.show({
        color: 'green',
        message: '분석이 완료되었습니다'
      })

    } catch (err) {
      const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다'
      setError(message)
      notifications.show({
        color: 'red',
        message
      })
    } finally {
      setLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) {
      handleAnalyze()
    }
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      notifications.show({
        color: 'green',
        message: '클립보드에 복사되었습니다'
      })
    } catch (err) {
      notifications.show({
        color: 'red',
        message: '복사에 실패했습니다'
      })
    }
  }

  return (
    <div className="container">
      {/* Header */}
      <Group justify="space-between" align="flex-start" mb="lg">
        <div>
          <Title order={2}>🔍 Sentry 이슈 분석</Title>
          <Text c="dimmed" size="sm">
            AI 기반 Sentry 이슈 원인 분석 및 해결방안 제공
          </Text>
        </div>
      </Group>

      {/* 사용 방법 */}
      <Card withBorder radius="lg" p="lg" mb="lg" style={{ 
        backgroundColor: 'rgba(59, 130, 246, 0.05)',
        borderColor: 'rgba(59, 130, 246, 0.2)'
      }}>
        <Title order={4} mb="md">📋 사용 방법</Title>
        <Text mb="md">
          Sentry 이슈 번호를 입력하면 AI가 자세한 원인 분석과 해결 방안을 제공합니다.
        </Text>
        <Text size="sm" c="dimmed">
          <strong>지원 형식:</strong> FINDA-IOS-ABC, 4567891234, https://finda-b2c.sentry.io/issues/4567891234/
        </Text>
      </Card>

      {/* 입력 섹션 */}
      <Card withBorder radius="lg" p="lg" mb="lg">
        <Stack gap="md">
          <TextInput
            label="이슈 번호 또는 URL"
            placeholder="예: FINDA-IOS-3RR 또는 4567891234 또는 전체 URL"
            description="Sentry 이슈 페이지에서 이슈 번호를 복사하거나 전체 URL을 붙여넣으세요."
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            onKeyDown={handleKeyPress}
            rightSection={
              <Button 
                variant="subtle" 
                size="xs"
                onClick={() => copyToClipboard(input)}
                disabled={!input.trim()}
              >
                <IconClipboard size={14} />
              </Button>
            }
          />
          <Group>
            <Button
              leftSection={<IconSearch size={16} />}
              onClick={handleAnalyze}
              loading={loading}
              disabled={!input.trim()}
            >
              {loading ? '분석 중...' : '분석 시작'}
            </Button>
          </Group>
        </Stack>
      </Card>

      {/* 에러 표시 */}
      {error && (
        <Alert 
          icon={<IconAlertTriangle size={16} />} 
          color="red" 
          variant="light"
          mb="lg"
        >
          <Text fw={600} mb={4}>분석 실패</Text>
          <Text size="sm">{error}</Text>
        </Alert>
      )}

      {/* 결과 표시 */}
      {result && (
        <Stack gap="lg">
          {/* 이슈 정보 */}
          <Card withBorder radius="lg" p="lg">
            <Title order={3} mb="lg">📊 분석 결과</Title>
            
            <Title order={4} mb="md">📝 이슈 정보</Title>
            <Stack gap="sm" mb="lg">
              <Group gap="md">
                <Text fw={600}>이슈 ID:</Text>
                <Text>{result.issueInfo.shortId || result.issueInfo.issueId}</Text>
              </Group>
              
              <div>
                <Text fw={600} mb="xs">제목:</Text>
                <Text size="sm" style={{ wordBreak: 'break-all' }}>
                  {result.issueInfo.title}
                </Text>
              </div>
              
              <Group gap="xl">
                <Group gap="xs">
                  <Text fw={600}>레벨:</Text>
                  <Badge 
                    color={getLevelColor(result.issueInfo.level)} 
                    variant="light"
                    leftSection={getLevelIcon(result.issueInfo.level)}
                  >
                    {result.issueInfo.level}
                  </Badge>
                </Group>
                
                <Group gap="xs">
                  <Text fw={600}>상태:</Text>
                  <Badge color={result.issueInfo.status === 'resolved' ? 'green' : 'red'} variant="light">
                    {result.issueInfo.status}
                  </Badge>
                </Group>
              </Group>
              
              <Group gap="xl">
                <Text><strong>발생 횟수:</strong> {formatNumber(result.issueInfo.eventCount)}회</Text>
                <Text><strong>영향받은 사용자:</strong> {formatNumber(result.issueInfo.userCount)}명</Text>
              </Group>
              
              <Group gap="xl">
                <Text size="sm"><strong>첫 발생:</strong> {formatDate(result.issueInfo.firstSeen)}</Text>
                <Text size="sm"><strong>마지막 발생:</strong> {formatDate(result.issueInfo.lastSeen)}</Text>
              </Group>
              
              <Group>
                <Text fw={600}>링크:</Text>
                <Anchor 
                  href={result.issueInfo.sentryUrl} 
                  target="_blank"
                >
                  Sentry에서 보기 <IconExternalLink size={12} style={{ display: 'inline', marginLeft: 4 }} />
                </Anchor>
              </Group>
            </Stack>

            <Divider mb="lg" />

            {/* AI 분석 결과 */}
            <Title order={4} mb="md" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <IconBrain size={20} />
              🧠 AI 분석 결과
            </Title>
            
            {/* 심각도 & 카테고리 */}
            <Card withBorder p="md" mb="lg" style={{ backgroundColor: 'rgba(239, 68, 68, 0.05)' }}>
              <Title order={5} mb="md" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <IconTarget size={16} />
                🎯 심각도 & 카테고리
              </Title>
              <Group gap="xl">
                <Group gap="xs">
                  <Text fw={600}>심각도:</Text>
                  <Badge 
                    color={getSeverityColor(result.analysis.severity)} 
                    variant="filled"
                    leftSection={getSeverityIcon(result.analysis.severity)}
                  >
                    {result.analysis.severity}
                  </Badge>
                </Group>
                <Group gap="xs">
                  <Text fw={600}>카테고리:</Text>
                  <Text>{result.analysis.category}</Text>
                </Group>
              </Group>
            </Card>

            {/* 원인 분석 */}
            <Card withBorder p="md" mb="lg" style={{ backgroundColor: 'rgba(59, 130, 246, 0.05)' }}>
              <Group justify="space-between" align="center" mb="md">
                <Title order={5}>🔍 원인 분석</Title>
                <Button
                  variant="subtle"
                  size="xs"
                  rightSection={showDetailedEvidence ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
                  onClick={() => setShowDetailedEvidence(!showDetailedEvidence)}
                >
                  📋 자세한 근거 보기
                </Button>
              </Group>
              <Text style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                {result.analysis.detailedAnalysis}
              </Text>
            </Card>

            {/* 해결 방안 */}
            <Card withBorder p="md" mb="lg" style={{ backgroundColor: 'rgba(34, 197, 94, 0.05)' }}>
              <Title order={5} mb="md" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <IconBulb size={16} />
                💡 해결 방안
              </Title>
              
              <Stack gap="md">
                <div>
                  <Text fw={600} mb="xs">1. 긴급 대응:</Text>
                  <List size="sm">
                    {result.analysis.solutions.immediate.map((solution, idx) => (
                      <List.Item key={idx}>{solution}</List.Item>
                    ))}
                  </List>
                </div>

                <div>
                  <Text fw={600} mb="xs">2. 근본적 해결:</Text>
                  <List size="sm">
                    {result.analysis.solutions.longTerm.map((solution, idx) => (
                      <List.Item key={idx}>{solution}</List.Item>
                    ))}
                  </List>
                </div>

                {result.analysis.solutions.codeExample && (
                  <div>
                    <Group justify="space-between" align="center" mb="xs">
                      <Text fw={600}>코드 예제:</Text>
                      <Button
                        variant="subtle"
                        size="xs"
                        leftSection={<IconCode size={14} />}
                        onClick={() => copyToClipboard(result.analysis.solutions.codeExample!)}
                      >
                        복사
                      </Button>
                    </Group>
                    <Code block style={{ fontSize: '12px', lineHeight: 1.4 }}>
                      {result.analysis.solutions.codeExample}
                    </Code>
                  </div>
                )}

                {result.analysis.solutions.monitoring && result.analysis.solutions.monitoring.length > 0 && (
                  <div>
                    <Text fw={600} mb="xs">3. 모니터링 강화:</Text>
                    <List size="sm">
                      {result.analysis.solutions.monitoring.map((item, idx) => (
                        <List.Item key={idx}>{item}</List.Item>
                      ))}
                    </List>
                  </div>
                )}

                {result.analysis.solutions.prevention && result.analysis.solutions.prevention.length > 0 && (
                  <div>
                    <Text fw={600} mb="xs">4. 예방 조치:</Text>
                    <List size="sm">
                      {result.analysis.solutions.prevention.map((item, idx) => (
                        <List.Item key={idx}>{item}</List.Item>
                      ))}
                    </List>
                  </div>
                )}

                {result.analysis.references && result.analysis.references.length > 0 && (
                  <div>
                    <Text fw={600} mb="xs">참고 자료:</Text>
                    <Text size="sm" fs="italic">
                      {result.analysis.references.join(', ')}
                    </Text>
                  </div>
                )}
              </Stack>
            </Card>

            {/* 상세 근거 */}
            <Collapse in={showDetailedEvidence}>
              {result.analysis.detailedEvidence && (
                <Card withBorder p="md" style={{ backgroundColor: 'rgba(168, 85, 247, 0.05)' }}>
                  <Title order={5} mb="md" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <IconEye size={16} />
                    📊 상세 분석 근거
                  </Title>
                  
                  <Stack gap="md">
                    <div>
                      <Text fw={600} mb="xs">🔍 Stack Trace 분석</Text>
                      <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                        {result.analysis.detailedEvidence.stackTrace}
                      </Text>
                    </div>

                    <div>
                      <Text fw={600} mb="xs">👣 Breadcrumbs 패턴</Text>
                      <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                        {result.analysis.detailedEvidence.breadcrumbs}
                      </Text>
                    </div>

                    <div>
                      <Text fw={600} mb="xs">🔗 Event Grouping 기준</Text>
                      <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                        {result.analysis.detailedEvidence.eventGrouping}
                      </Text>
                    </div>

                    <div>
                      <Text fw={600} mb="xs">📊 분석 근거</Text>
                      <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                        {result.analysis.detailedEvidence.analysisReasoning}
                      </Text>
                    </div>

                    <div>
                      <Text fw={600} mb="xs">📚 참고 데이터</Text>
                      <List size="sm">
                        {result.analysis.detailedEvidence.referenceData.map((data, idx) => (
                          <List.Item key={idx}>{data}</List.Item>
                        ))}
                      </List>
                    </div>
                  </Stack>
                </Card>
              )}
            </Collapse>
          </Card>
        </Stack>
      )}
    </div>
  )
}