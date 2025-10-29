'use client'

import React, { useMemo, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Stack,
  Text,
  Title,
  Grid,
  Alert,
  RingProgress,
  Paper,
  List,
  Table,
  Select,
  Accordion,
  Code,
  Pagination
} from '@mantine/core'
import {
  IconChevronLeft,
  IconChevronRight,
  IconRefresh,
  IconBrandAndroid,
  IconBrandApple,
  IconBug,
  IconUsers,
  IconAlertTriangle,
  IconShield,
  IconFileAnalytics,
  IconList,
  IconTrendingUp,
  IconTrendingDown,
  IconMinus,
  IconTrash,
  IconRobot,
  IconChartLine,
  IconTable,
  IconInfoCircle,
  IconSparkles,
  IconExternalLink,
  IconHistory
} from '@tabler/icons-react'
import StatusBadge from '@/components/StatusBadge'
import SectionToggle from '@/components/SectionToggle'
import SlackPreview from '@/lib/SlackPreview'
import LoadingScreen from '@/components/LoadingScreen'
import { formatExecutionTime, formatKST } from '@/lib/utils'
import { useReportHistory } from '@/lib/reports/useReportHistory'
import type { Platform } from '@/lib/types'
import type { DailyReportData, ReportExecution } from '@/lib/reports/types'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { Tabs } from '@mantine/core'
import { format, parseISO } from 'date-fns'

type DailyReportPayload = (DailyReportData & { slack_blocks?: unknown }) | undefined

type DayData = Exclude<DailyReportData[string], string>

type NormalizedIssue = {
  issueId: string
  title: string
  events: number
  users: number | null
  link?: string
}

type FilterType = 'all' | 'surge' | 'new' | 'fatal'
type SortOption = 'count' | 'users' | 'growth'

interface IssueWithMetadata {
  id: string
  title: string
  count: number
  users: number
  delta: number
  percentage: number
  avg7Days?: number
  isNew: boolean
  isSurge: boolean
  level?: string
  aiNote?: string
  sentryUrl: string
}

interface DailyReportComponentProps {
  platform: Platform
}

function getPlatformConfig(platform: Platform) {
  if (platform === 'android') {
    return {
      title: 'Android 일간 리포트',
      description: 'Android 플랫폼의 Sentry 일간 크래시 리포트를 생성하고 관리합니다.',
      icon: <IconBrandAndroid size={32} color="green" />,
      color: 'green',
      gradient: 'linear-gradient(135deg, rgba(34, 197, 94, 0.05) 0%, rgba(16, 185, 129, 0.05) 100%)',
      borderColor: 'rgba(34, 197, 94, 0.2)',
      ringColor: 'green'
    }
  } else {
    return {
      title: 'iOS 일간 리포트',
      description: 'iOS 플랫폼의 Sentry 일간 크래시 리포트를 생성하고 관리합니다.',
      icon: <IconBrandApple size={32} color="blue" />,
      color: 'blue',
      gradient: 'linear-gradient(135deg, rgba(59, 130, 246, 0.05) 0%, rgba(147, 51, 234, 0.05) 100%)',
      borderColor: 'rgba(59, 130, 246, 0.2)',
      ringColor: 'blue'
    }
  }
}

const formatDateLabel = (date?: string) => {
  if (!date) return '-'
  return formatKST(`${date}T00:00:00Z`).split(' ')[0] ?? date
}

const toPercent = (value?: number | null) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '-'
  const percent = value <= 1 ? value * 100 : value
  return `${percent.toFixed(1)}%`
}

const formatNumber = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '0'
  return value.toLocaleString()
}

// 변동률 계산
const calculateChange = (current: number | null | undefined, previous: number | null | undefined) => {
  const curr = Number(current) || 0
  const prev = Number(previous) || 0
  
  if (prev === 0) {
    return curr > 0 ? { percent: 100, trend: 'up' as const } : { percent: 0, trend: 'stable' as const }
  }
  
  const change = ((curr - prev) / prev) * 100
  if (Math.abs(change) < 1) return { percent: Math.abs(change), trend: 'stable' as const }
  
  return {
    percent: Math.abs(change),
    trend: change > 0 ? 'up' as const : 'down' as const
  }
}

// 변동률 표시 컴포넌트
const ChangeIndicator = ({ current, previous, unit = '', isCrashFreeRate = false }: { 
  current: number | null | undefined, 
  previous: number | null | undefined, 
  unit?: string,
  isCrashFreeRate?: boolean 
}) => {
  const { percent, trend } = calculateChange(current, previous)
  
  const curr = Number(current) || 0
  const prev = Number(previous) || 0
  const absoluteChange = curr - prev
  const sign = trend === 'up' ? '+' : ''
  
  // 변동 없음 표시
  if (trend === 'stable') {
    return (
      <Group gap={4} align="center">
        <IconMinus size={14} color="gray" />
        <Text size="xs" c="gray" fw={600}>
          변동없음
        </Text>
      </Group>
    )
  }
  
  const color = trend === 'up' ? 'red' : 'green'
  const Icon = trend === 'up' ? IconTrendingUp : IconTrendingDown
  
  // Crash Free Rate의 경우 퍼센트 포인트만 표시
  if (isCrashFreeRate) {
    return (
      <Group gap={4} align="center">
        <Icon size={14} color={color} />
        <Text size="xs" c={color} fw={600}>
          {sign}{Math.abs(absoluteChange).toFixed(2)}%p
        </Text>
      </Group>
    )
  }
  
  // 일반 지표의 경우 절대값과 백분율 모두 표시
  const displayValue = formatNumber(Math.abs(absoluteChange))
  
  return (
    <Group gap={4} align="center">
      <Icon size={14} color={color} />
      <Text size="xs" c={color} fw={600}>
        {displayValue}{unit}({sign}{percent.toFixed(1)}%)
      </Text>
    </Group>
  )
}

function normalizeTopIssues(items?: any[]): NormalizedIssue[] {
  if (!Array.isArray(items)) return []
  return items.map((issue, idx) => {
    const issueId = String(
      issue?.issue_id || issue?.issueId || issue?.['issue.id'] || issue?.issue || `issue-${idx}`,
    )
    return {
      issueId,
      title: issue?.title || issue?.culprit || issue?.message || '제목 없음',
      events: Number(issue?.event_count ?? issue?.events ?? issue?.['count()'] ?? 0),
      users: issue?.users ?? issue?.user_count ?? null,
      link: issue?.link || issue?.permalink || undefined,
    }
  })
}

// 평균 계산
const mean = (arr: number[]): number => {
  if (arr.length === 0) return 0
  return arr.reduce((sum, val) => sum + val, 0) / arr.length
}

// 델타 포맷팅 (+50% or -30%)
const formatDeltaPercent = (delta: number): string => {
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toFixed(1)}%`
}

// 델타 색상 (이벤트/이슈/사용자는 감소가 좋음)
const getDeltaColor = (delta: number): string => {
  if (delta < -10) return 'green'  // 감소 = 좋음
  if (delta > 50) return 'red'     // 급증 = 나쁨
  return 'gray'
}

// Crash Free Rate 델타 색상 (증가가 좋음)
const getCrashFreeDeltaColor = (delta: number): string => {
  if (delta > 0.1) return 'green'   // 증가 = 좋음
  if (delta < -0.5) return 'red'    // 하락 = 나쁨
  return 'gray'
}

// 7일 평균 대비 비교
const formatComparison = (current: number, avg: number): string => {
  if (avg === 0) return '0%'
  const diff = ((current - avg) / avg) * 100
  const sign = diff > 0 ? '+' : ''
  return `${sign}${diff.toFixed(0)}%`
}

// 비교 색상 (이벤트/이슈/사용자는 평균보다 낮으면 좋음)
const getComparisonColor = (current: number, avg: number, isCrashFree = false): string => {
  if (avg === 0) return 'gray'
  const diff = ((current - avg) / avg) * 100

  if (isCrashFree) {
    // Crash Free Rate는 평균보다 높으면 좋음
    if (diff > 0.5) return 'green'
    if (diff < -0.5) return 'red'
    return 'gray'
  } else {
    // 이벤트/이슈/사용자는 평균보다 낮으면 좋음
    if (diff < -20) return 'green'
    if (diff > 20) return 'red'
    return 'gray'
  }
}

// 해석 생성
const getInterpretation = (
  yesterday: { events: number; issues: number; users: number; crashFreeRate: number } | undefined,
  avg7Days: { events: number; issues: number; users: number; crashFreeRate: number }
): string => {
  if (!yesterday) return '데이터가 충분하지 않습니다.'

  const comparisons: string[] = []

  if (avg7Days.events > 0 && yesterday.events < avg7Days.events * 0.8) {
    comparisons.push('이벤트 수가 평균보다 20% 이상 낮습니다')
  }
  if (avg7Days.crashFreeRate > 0 && yesterday.crashFreeRate > avg7Days.crashFreeRate) {
    comparisons.push('Crash Free Rate가 평균보다 높습니다')
  }
  if (avg7Days.events > 0 && yesterday.events > avg7Days.events * 1.5) {
    comparisons.push('이벤트 수가 평균보다 50% 이상 높습니다')
  }

  if (comparisons.length > 0) {
    const sentiment = yesterday.events < avg7Days.events && yesterday.crashFreeRate >= avg7Days.crashFreeRate
      ? '전반적으로 안정적입니다'
      : '주의가 필요합니다'
    return `어제는 최근 7일 평균보다 ${comparisons.join(', ')}. ${sentiment}.`
  }

  return '어제는 최근 7일 평균과 비슷한 수준입니다.'
}

export default function DailyReportComponent({ platform }: DailyReportComponentProps) {
  const searchParams = useSearchParams()
  const targetDate = searchParams.get('date')
  
  const {
    reports,
    selectedReport,
    selectedIndex,
    isLoading,
    error,
    hasOlder,
    hasNewer,
    goOlder,
    goNewer,
    goToDate,
    refresh,
  } = useReportHistory({ reportType: 'daily', platform, limit: 20 })

  const [expandedSections, setExpandedSections] = useState({ logs: false, data: false, slack: false, report: false })
  const [issueModal, setIssueModal] = useState<{ open: boolean; item?: NormalizedIssue; dateKey?: string }>({ open: false })
  const [issueAnalysis, setIssueAnalysis] = useState<any | null>(null)
  const [issueLoading, setIssueLoading] = useState(false)
  const [issueError, setIssueError] = useState('')
  const [deleteModal, setDeleteModal] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [last7DaysData, setLast7DaysData] = useState<Array<{
    date: string
    events: number
    issues: number
    users: number
    crashFreeRate: number
  }>>([])
  const [chartLoading, setChartLoading] = useState(false)
  const [issueFilter, setIssueFilter] = useState<FilterType>('all')
  const [issueSortBy, setIssueSortBy] = useState<SortOption>('count')
  const [sentryIssues, setSentryIssues] = useState<IssueWithMetadata[]>([])
  const [sentryLoading, setSentryLoading] = useState(false)
  // 전체 이슈 목록 페이지네이션
  const PAGE_SIZE = 5
  const [issuePage, setIssuePage] = useState(1)

  const config = getPlatformConfig(platform)

  // URL 파라미터로 전달된 날짜로 이동
  useEffect(() => {
    if (targetDate && reports.length > 0) {
      goToDate(targetDate)
    }
  }, [targetDate, reports, goToDate])

  // Sentry API에서 데이터 가져오기 (최근 7일 + 이슈 목록)
  useEffect(() => {
    const fetchSentryData = async () => {
      if (!selectedReport?.target_date) return

      setChartLoading(true)
      setSentryLoading(true)
      try {
        const response = await fetch(`/api/reports/daily/sentry-data?platform=${platform}&targetDate=${selectedReport.target_date}`)
        const result = await response.json()

        if (result.success && result.data) {
          // 7일 데이터 설정
          setLast7DaysData(result.data.last7DaysData || [])

          // 이슈 데이터 변환
          const totalEvents = result.data.totalEvents || 0
          const transformedIssues: IssueWithMetadata[] = (result.data.issues || []).map((issue: any) => {
            const percentage = totalEvents > 0 ? (issue.count / totalEvents) * 100 : 0

            return {
              id: issue.id,
              title: issue.title || issue.culprit || '제목 없음',
              count: issue.count,
              users: issue.users || 0,
              delta: issue.delta || 0,
              percentage,
              isNew: issue.isNew || false,
              isSurge: issue.isSurge || false,
              level: issue.count >= 500 ? 'fatal' : undefined,
              sentryUrl: issue.link || '#'
            }
          })

          setSentryIssues(transformedIssues)
        }
      } catch (error) {
        console.error('Failed to fetch Sentry data:', error)
      } finally {
        setChartLoading(false)
        setSentryLoading(false)
      }
    }

    fetchSentryData()
  }, [selectedReport?.target_date, platform])

  const payload = useMemo<DailyReportPayload>(() => {
    if (!selectedReport?.result_data) return undefined
    return selectedReport.result_data as DailyReportPayload
  }, [selectedReport])

  const dayData = useMemo<DayData | null>(() => {
    if (!payload || !selectedReport?.target_date) return null
    const data = payload[selectedReport.target_date]
    if (!data || typeof data === 'string') {
      return null
    }
    return data
  }, [payload, selectedReport])

  // 전일 데이터 추출
  const previousDayData = useMemo<DayData | null>(() => {
    if (!payload || !selectedReport?.target_date) return null
    
    // 현재 날짜에서 하루 전 날짜 계산
    const currentDate = new Date(selectedReport.target_date + 'T00:00:00Z')
    const previousDate = new Date(currentDate)
    previousDate.setDate(currentDate.getDate() - 1)
    const previousDateStr = previousDate.toISOString().split('T')[0]
    
    const data = payload[previousDateStr]
    if (!data || typeof data === 'string') {
      return null
    }
    return data
  }, [payload, selectedReport])

  const topIssues = useMemo(() => normalizeTopIssues((dayData as any)?.top_5_issues), [dayData])

  // Critical 이슈 추출 (상세 정보 포함)
  const criticalIssuesDetailed = useMemo(() => {
    if (!dayData) return []

    const totalUsers = dayData.impacted_users || 0
    const surgelist = (dayData as any)?.surge_issues || []
    const newIssues = (dayData as any)?.new_issues || []

    // Top 5 중에서 Critical 이슈 찾기
    return topIssues
      .filter(issue => {
        // Fatal 레벨 + 50건 이상 또는 사용자 10% 이상 영향
        const isFatal = issue.events >= 50
        const isHighImpact = issue.users && totalUsers > 0 && (issue.users / totalUsers) > 0.1
        const isHighCount = issue.events >= 500

        return isFatal && (isHighImpact || isHighCount)
      })
      .map(issue => {
        const percentage = issue.users && totalUsers > 0
          ? ((issue.users / totalUsers) * 100).toFixed(1)
          : '0'

        return {
          id: issue.issueId,
          title: issue.title,
          count: issue.events,
          users: issue.users || 0,
          percentage,
          culprit: issue.title.length > 60 ? issue.title.substring(0, 60) + '...' : issue.title,
          sentryUrl: issue.link || '#',
          aiSummary: undefined // AI 요약은 별도 API로 가져올 수 있음
        }
      })
  }, [dayData, topIssues])

  // 급증 이슈 추출 (상세 정보 포함)
  const surgeIssuesDetailed = useMemo(() => {
    if (!dayData) return []

    const surgeList = (dayData as any)?.surge_issues || []
    const newIssues = (dayData as any)?.new_issues || []

    return surgeList.slice(0, 5).map((issue: any) => {
      const isNew = newIssues.some((n: any) => n.issue_id === issue.issue_id)
      const growthRate = !isNew && issue.dby_count > 0
        ? Math.round(((issue.event_count - issue.dby_count) / issue.dby_count) * 100)
        : undefined

      return {
        id: issue.issue_id,
        title: issue.title,
        count: issue.event_count,
        previousCount: issue.dby_count || 0,
        users: 0, // surge_issues에는 users 정보가 없음
        isNew,
        growthRate,
        zscore: issue.zscore || 0,
        madscore: issue.mad_score || 0,
        sentryUrl: issue.link || '#'
      }
    })
  }, [dayData])

  const criticalIssues = useMemo(() => {
    return topIssues.filter(issue => issue.events > 500 || (issue.users && issue.users > 100))
  }, [topIssues])

  // 전체 이슈 목록 - Sentry API에서 가져온 데이터 사용
  const allIssuesWithMetadata = useMemo((): IssueWithMetadata[] => {
    // Sentry API에서 가져온 이슈 사용
    if (sentryIssues.length > 0) {
      return sentryIssues
    }

    // Fallback: DB에 저장된 데이터 사용
    if (!dayData || !previousDayData) return []

    const totalEvents = dayData.crash_events || 0
    const surgeList = (dayData as any)?.surge_issues || []
    const newIssuesList = (dayData as any)?.new_issues || []
    const aiAnalysis = selectedReport?.ai_analysis as any
    const aiNotes = aiAnalysis?.per_issue_notes || []

    // Top issues를 기반으로 메타데이터 추가
    return topIssues.map(issue => {
      // 신규 이슈 여부
      const isNew = newIssuesList.some((n: any) => n.issue_id === issue.issueId)

      // 급증 이슈 여부
      const isSurge = surgeList.some((s: any) => s.issue_id === issue.issueId)

      // 전일 대비 델타 계산
      const previousIssue = (previousDayData as any)?.top_5_issues?.find(
        (i: any) => i.issue_id === issue.issueId
      )
      const previousCount = previousIssue?.event_count || 0
      const delta = previousCount > 0 ? ((issue.events - previousCount) / previousCount) * 100 : 0

      // 전체 이벤트 대비 비율
      const percentage = totalEvents > 0 ? (issue.events / totalEvents) * 100 : 0

      // AI 노트 찾기
      const aiNote = aiNotes.find((note: any) => {
        const noteTitle = (note.issue_title || '').toLowerCase().trim()
        const issueTitle = (issue.title || '').toLowerCase().trim()
        return noteTitle === issueTitle || noteTitle.includes(issueTitle) || issueTitle.includes(noteTitle)
      })?.note

      return {
        id: issue.issueId,
        title: issue.title,
        count: issue.events,
        users: issue.users || 0,
        delta,
        percentage,
        avg7Days: undefined, // 7일 평균은 별도 계산 필요
        isNew,
        isSurge,
        level: issue.events >= 500 ? 'fatal' : undefined,
        aiNote,
        sentryUrl: issue.link || '#'
      }
    })
  }, [sentryIssues, dayData, previousDayData, topIssues, selectedReport])

  // 필터링 및 정렬된 이슈 목록
  const filteredAndSortedIssues = useMemo(() => {
    let filtered = [...allIssuesWithMetadata]

    // 필터 적용
    switch (issueFilter) {
      case 'surge':
        filtered = filtered.filter(i => i.isSurge)
        break
      case 'new':
        filtered = filtered.filter(i => i.isNew)
        break
      case 'fatal':
        filtered = filtered.filter(i => i.level === 'fatal')
        break
      default:
        // 'all' - 모든 이슈
        break
    }

    // 정렬 적용
    switch (issueSortBy) {
      case 'count':
        filtered.sort((a, b) => b.count - a.count)
        break
      case 'users':
        filtered.sort((a, b) => b.users - a.users)
        break
      case 'growth':
        filtered.sort((a, b) => b.delta - a.delta)
        break
    }

    return filtered
  }, [allIssuesWithMetadata, issueFilter, issueSortBy])

  // 필터/정렬/리포트 변경 시 페이지 리셋
  useEffect(() => {
    setIssuePage(1)
  }, [issueFilter, issueSortBy, selectedReport])

  // 페이지 단위로 슬라이싱
  const totalIssuePages = useMemo(() => {
    const total = filteredAndSortedIssues.length
    return total > 0 ? Math.ceil(total / PAGE_SIZE) : 1
  }, [filteredAndSortedIssues.length])

  const pagedIssues = useMemo(() => {
    const start = (issuePage - 1) * PAGE_SIZE
    const end = start + PAGE_SIZE
    return filteredAndSortedIssues.slice(start, end)
  }, [filteredAndSortedIssues, issuePage])

  // 각 필터별 개수
  const issueCountsByFilter = useMemo(() => {
    return {
      all: allIssuesWithMetadata.length,
      surge: allIssuesWithMetadata.filter(i => i.isSurge).length,
      new: allIssuesWithMetadata.filter(i => i.isNew).length,
      fatal: allIssuesWithMetadata.filter(i => i.level === 'fatal').length
    }
  }, [allIssuesWithMetadata])

  // AI 코멘트 추출
  const aiComment = useMemo(() => {
    if (!selectedReport) return null
    
    // AI 분석 데이터는 selectedReport.ai_analysis 필드에 저장됨
    const aiAnalysis = selectedReport.ai_analysis as any
    if (!aiAnalysis) return null
    
    // newsletter_summary 필드가 AI 코멘트
    const comment = aiAnalysis.newsletter_summary
    
    return comment || null
  }, [selectedReport])

  // AI 오늘의 액션 추출
  const aiActions = useMemo(() => {
    if (!selectedReport) return []

    const aiAnalysis = selectedReport.ai_analysis as any
    if (!aiAnalysis || !aiAnalysis.today_actions) return []

    return aiAnalysis.today_actions
  }, [selectedReport])

  // AI 종합 분석 추출
  const aiFullAnalysis = useMemo(() => {
    if (!selectedReport) return null

    const aiAnalysis = selectedReport.ai_analysis as any
    if (!aiAnalysis) return null

    // full_analysis가 있으면 사용, 없으면 fallback
    if (aiAnalysis.full_analysis) {
      return aiAnalysis.full_analysis
    }

    // fallback: newsletter_summary를 overview로 사용
    if (aiAnalysis.newsletter_summary) {
      return {
        overview: aiAnalysis.newsletter_summary,
        trend_analysis: '데이터가 충분하지 않습니다.',
        key_insights: [],
        recommendations: '지속적인 모니터링이 필요합니다.'
      }
    }

    return null
  }, [selectedReport])

  // 비교 테이블 데이터 계산
  const comparisonData = useMemo(() => {
    if (last7DaysData.length === 0) return null

    const yesterday = last7DaysData[last7DaysData.length - 1]
    const dayBefore = last7DaysData.length > 1 ? last7DaysData[last7DaysData.length - 2] : undefined

    const avg7Days = {
      events: mean(last7DaysData.map(d => d.events)),
      issues: mean(last7DaysData.map(d => d.issues)),
      users: mean(last7DaysData.map(d => d.users)),
      crashFreeRate: mean(last7DaysData.map(d => d.crashFreeRate))
    }

    // 델타 계산 (어제 vs 그저께)
    const calculateDelta = (current: number, previous: number | undefined): number => {
      if (previous === undefined || previous === 0) return 0
      return ((current - previous) / previous) * 100
    }

    const deltas = {
      events: calculateDelta(yesterday.events, dayBefore?.events),
      issues: calculateDelta(yesterday.issues, dayBefore?.issues),
      users: calculateDelta(yesterday.users, dayBefore?.users),
      crashFreeRate: yesterday.crashFreeRate - (dayBefore?.crashFreeRate || 0) // %p 차이
    }

    return {
      yesterday,
      dayBefore,
      avg7Days,
      deltas
    }
  }, [last7DaysData])

  const dateLabel = formatDateLabel(selectedReport?.target_date)

  const handleOpenDetails = () => {
    // 섹션으로 스크롤
    const element = document.querySelector('[data-testid="report-details-section"]')
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const toggleSection = (section: 'logs' | 'data' | 'slack' | 'report') => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }))
  }

  const renderAnalysis = (text?: string) => {
    if (!text) return <span className="muted">아직 분석되지 않았습니다.</span>
    const html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br/>')
    return <span dangerouslySetInnerHTML={{ __html: html }} />
  }

  const openIssue = async (issue: NormalizedIssue) => {
    const dateKey = selectedReport?.target_date
    if (!dateKey) return

    setIssueModal({ open: true, item: issue, dateKey })
    setIssueAnalysis(null)
    setIssueError('')
    setIssueLoading(false)

    try {
      const res = await fetch(
        `/api/reports/issues/${encodeURIComponent(issue.issueId)}/analysis?platform=${platform}&type=daily&dateKey=${dateKey}`,
      )
      const json = await res.json()
      if (json?.success) {
        setIssueAnalysis(json.data?.analysis || null)
      } else if (json?.error) {
        setIssueError(json.error)
      }
    } catch (err) {
      setIssueError(err instanceof Error ? err.message : '이슈 분석을 불러오지 못했습니다.')
    }
  }

  const runIssueAnalysis = async (force = true) => {
    if (!issueModal.item || !issueModal.dateKey) return
    setIssueLoading(true)
    setIssueAnalysis(null)
    setIssueError('')

    try {
      const res = await fetch(`/api/reports/issues/${encodeURIComponent(issueModal.item.issueId)}/analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, type: 'daily', dateKey: issueModal.dateKey, force }),
      })
      const json = await res.json()
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || 'AI 분석 실패')
      }
      setIssueAnalysis(json.data?.analysis || null)
    } catch (err) {
      setIssueError(err instanceof Error ? err.message : 'AI 분석 중 오류가 발생했습니다')
    } finally {
      setIssueLoading(false)
    }
  }

  const handleCloseIssueModal = () => {
    setIssueModal({ open: false })
    setIssueError('')
    setIssueAnalysis(null)
  }

  const handleShowHistory = (issueId: string) => {
    // 모달 또는 새 창에서 이 이슈의 과거 7일 발생 추이 표시
    // 현재는 alert로 대체 (추후 구현)
    alert('히스토리 기능은 추후 구현 예정입니다.')
  }

  const triggerLabel = selectedReport?.trigger_type === 'scheduled' ? '🤖 자동 실행' : '🧪 테스트 실행'
  const triggerColor = selectedReport?.trigger_type === 'scheduled' ? 'blue' : 'pink'

  // 리포트 삭제 함수
  const handleDeleteReport = async () => {
    if (!selectedReport) return
    
    setDeleting(true)
    try {
      const response = await fetch(`/api/reports/daily/${selectedReport.id}`, {
        method: 'DELETE',
      })
      
      if (!response.ok) {
        throw new Error('리포트 삭제에 실패했습니다.')
      }
      
      // 삭제 성공 시 리스트 새로고침
      await refresh()
      setDeleteModal(false)
      
    } catch (error) {
      console.error('리포트 삭제 오류:', error)
      alert('리포트 삭제에 실패했습니다.')
    } finally {
      setDeleting(false)
    }
  }

  // 초기 로딩 상태
  if (isLoading && !reports.length) {
    return (
      <LoadingScreen
        icon={config.icon}
        title={`${config.title} 데이터를 불러오는 중...`}
        subtitle="최신 일간 리포트 데이터를 분석하고 있습니다"
      />
    )
  }

  // 에러 상태
  if (error && !reports.length) {
    return (
      <div className="container">
        <Alert icon={<IconAlertTriangle size={16} />} color="red" mb="lg">
          <Text fw={600} mb={4}>⚠️ 데이터 로딩 오류</Text>
          <Text size="sm">{error}</Text>
        </Alert>
      </div>
    )
  }

  // 리포트가 없는 상태
  if (!isLoading && !reports.length) {
    return (
      <div className="container">
        <Alert icon={<IconAlertTriangle size={16} />} color="yellow" mb="lg">
          <Text fw={600} mb={4}>📋 리포트가 없습니다</Text>
          <Text size="sm">{platform.toUpperCase()} 일간 리포트가 아직 생성되지 않았습니다.</Text>
        </Alert>
      </div>
    )
  }

  return (
    <div className="container">
      {/* 헤더 */}
      <Group justify="space-between" align="flex-start" mb="lg">
        <div>
          <Group gap="md" align="center" mb={4}>
            {config.icon}
            <Title order={2} c={`${config.color}.6`}>{config.title}</Title>
          </Group>
          <Text c="dimmed" size="sm">{config.description}</Text>
        </div>
        <Group gap="sm">
          <Button
            variant="default"
            size="sm"
            leftSection={<IconRefresh size={16} />}
            onClick={refresh}
            loading={isLoading}
          >
            새로고침
          </Button>
          {selectedReport && (
            <Button
              variant="light"
              color="red"
              size="sm"
              leftSection={<IconTrash size={16} />}
              onClick={() => setDeleteModal(true)}
            >
              삭제
            </Button>
          )}
        </Group>
      </Group>

      {/* 에러 알림 */}
      {error && (
        <Alert icon={<IconAlertTriangle size={16} />} color="red" mb="lg">
          <Text fw={600} mb={4}>⚠️ 데이터 로딩 오류</Text>
          <Text size="sm">{error}</Text>
        </Alert>
      )}

      

      {/* 일자 표시 */}
      {selectedReport && (
        <Group justify="space-between" align="center" mb="md">
          <Title order={2} c={`${config.color}.7`}>{dateLabel}</Title>
          <Group gap="xs" wrap="nowrap">
            <ActionIcon
              variant="default"
              aria-label="최근 리포트"
              onClick={goNewer}
              disabled={!hasNewer || isLoading}
              size="lg"
            >
              <IconChevronLeft size={16} />
            </ActionIcon>
            <ActionIcon
              variant="default"
              aria-label="이전 리포트"
              onClick={goOlder}
              disabled={!hasOlder || isLoading}
              size="lg"
            >
              <IconChevronRight size={16} />
            </ActionIcon>
          </Group>
        </Group>
      )}

      {/* 현황 카드 */}
      {selectedReport && dayData && (
        <Card withBorder radius="lg" p="lg" mb="lg" style={{ background: config.gradient, borderColor: config.borderColor }}>
          <Group justify="space-between" align="center" mb="lg">
            <div>
              <Group align="center" gap="md" mb={4}>
                <IconFileAnalytics size={20} color={config.color} />
                <Title order={3} c={`${config.color}.6`}>리포트 요약</Title>
                <Badge color={triggerColor} size="md" variant="filled" radius="sm">
                  {triggerLabel}
                </Badge>
                <StatusBadge kind="report" status={selectedReport.status} />
              </Group>
              <Text c="dimmed" size="sm">
                크래시 데이터 요약 (총 {reports.length}건 중 {selectedIndex + 1}번째)
              </Text>
            </div>
          </Group>

          {selectedReport.status === 'error' && (
            <Alert icon={<IconAlertTriangle size={16} />} color="red" mb="lg">
              <Text fw={600}>⚠️ 이 실행은 실패했습니다</Text>
              <Text size="sm">상세 화면에서 오류 메시지를 확인하세요.</Text>
            </Alert>
          )}

          <Grid>
            <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
              <Card withBorder p="md" style={{ backgroundColor: 'rgba(34, 197, 94, 0.05)', minHeight: '100px' }}>
                <Group justify="space-between" align="center" h="100%">
                  <div>
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                      Crash Free Rate (세션)
                    </Text>
                    <Text size="xl" fw={700} c={`${config.color}.6`}>
                      {toPercent(dayData.crash_free_sessions_pct)}
                    </Text>
                  </div>
                  <RingProgress
                    size={60}
                    thickness={6}
                    sections={[{ 
                      value: dayData.crash_free_sessions_pct ? 
                        (dayData.crash_free_sessions_pct <= 1 ? dayData.crash_free_sessions_pct * 100 : dayData.crash_free_sessions_pct) : 
                        100, 
                      color: config.ringColor 
                    }]}
                  />
                </Group>
              </Card>
            </Grid.Col>

            <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
              <Card withBorder p="md" style={{ backgroundColor: 'rgba(59, 130, 246, 0.05)', minHeight: '100px' }}>
                <Group justify="space-between" align="center" h="100%">
                  <div>
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                      총 이벤트
                    </Text>
                    <Text size="xl" fw={700} c="blue.6">
                      {formatNumber(dayData.crash_events)}건
                    </Text>
                    <ChangeIndicator 
                      current={dayData.crash_events} 
                      previous={previousDayData?.crash_events}
                      unit="건"
                    />
                  </div>
                  <IconBug size={32} color="blue" />
                </Group>
              </Card>
            </Grid.Col>

            <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
              <Card withBorder p="md" style={{ backgroundColor: 'rgba(168, 85, 247, 0.05)', minHeight: '100px' }}>
                <Group justify="space-between" align="center" h="100%">
                  <div>
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                      고유 이슈
                    </Text>
                    <Text size="xl" fw={700} c="violet.6">
                      {formatNumber(dayData.unique_issues || dayData.issues_count)}개
                    </Text>
                    <ChangeIndicator 
                      current={dayData.unique_issues || dayData.issues_count} 
                      previous={previousDayData?.unique_issues || previousDayData?.issues_count}
                      unit="개"
                    />
                  </div>
                  <IconBug size={32} color="violet" />
                </Group>
              </Card>
            </Grid.Col>

            <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
              <Card withBorder p="md" style={{ backgroundColor: 'rgba(239, 68, 68, 0.05)', minHeight: '100px' }}>
                <Group justify="space-between" align="center" h="100%">
                  <div>
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                      영향받은 사용자
                    </Text>
                    <Text size="xl" fw={700} c="red.6">
                      {formatNumber(dayData.impacted_users)}명
                    </Text>
                    <ChangeIndicator 
                      current={dayData.impacted_users} 
                      previous={previousDayData?.impacted_users}
                      unit="명"
                    />
                  </div>
                  <IconUsers size={32} color="red" />
                </Group>
              </Card>
            </Grid.Col>
          </Grid>

          {dayData.window_utc?.start && dayData.window_utc?.end && (
            <Text size="xs" c="dimmed" ta="center" mt="lg">
              📅 집계 구간 (KST 기준): {formatKST(dayData.window_utc.start)} ~ {formatKST(dayData.window_utc.end)}
            </Text>
          )}
        </Card>
      )}

      {/* AI 분석 섹션 */}
      {aiFullAnalysis && (
        <Paper p="xl" radius="md" withBorder mb="lg">
          <Group mb="md">
            <IconRobot size={24} color="teal" />
            <Text size="lg" fw={700} c="teal.7">AI 분석</Text>
          </Group>

          <Stack gap="md">
            <div>
              <Text size="sm" fw={600} c="teal.6" mb={4}>전체 상황</Text>
              <Text>{aiFullAnalysis.overview}</Text>
            </div>

            {aiFullAnalysis.trend_analysis && aiFullAnalysis.trend_analysis !== '데이터가 충분하지 않습니다.' && (
              <div>
                <Text size="sm" fw={600} c="teal.6" mb={4}>트렌드 분석</Text>
                <Text>{aiFullAnalysis.trend_analysis}</Text>
              </div>
            )}

            {aiFullAnalysis.key_insights && aiFullAnalysis.key_insights.length > 0 && (
              <div>
                <Text size="sm" fw={600} c="teal.6" mb={4}>핵심 인사이트</Text>
                <List>
                  {aiFullAnalysis.key_insights.map((insight: string, i: number) => (
                    <List.Item key={i}>{insight}</List.Item>
                  ))}
                </List>
              </div>
            )}

            <div>
              <Text size="sm" fw={600} c="teal.6" mb={4}>권장 사항</Text>
              <Text>{aiFullAnalysis.recommendations}</Text>
            </div>
          </Stack>
      </Paper>
      )}

      {/* 주요 이슈 섹션 (AI 분석과 7일 차트 사이) */}
      {aiFullAnalysis && selectedReport && (criticalIssuesDetailed.length > 0 || surgeIssuesDetailed.length > 0) && (
        <Stack gap="md" mb="lg">
          {/* Critical 이슈 */}
          {criticalIssuesDetailed.length > 0 && (
            <Paper p="xl" radius="md" withBorder style={{ borderColor: '#fa5252', borderWidth: 2 }}>
              <Group mb="md">
                <IconAlertTriangle size={24} color="#fa5252" />
                <Text size="lg" fw={700} c="red">🚨 Critical 이슈 ({criticalIssuesDetailed.length}건)</Text>
              </Group>

              <Stack gap="md">
                {criticalIssuesDetailed.map(issue => (
                  <Card key={issue.id} padding="md" radius="md" withBorder>
                    <Stack gap="xs">
                      <Text size="md" fw={600}>{issue.title}</Text>

                      <Group gap="md" wrap="wrap">
                        <Badge color="red" variant="filled">
                          💥 {formatNumber(issue.count)}건
                        </Badge>
                        <Badge color="orange" variant="light">
                          👥 {formatNumber(issue.users)}명 ({issue.percentage}%)
                        </Badge>
                        {issue.culprit && (
                          <Badge color="gray" variant="light" style={{ maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            📍 {issue.culprit}
                          </Badge>
                        )}
                      </Group>

                      {issue.aiSummary && (
                        <Alert icon={<IconRobot size={16} />} color="blue" variant="light">
                          🤖 {issue.aiSummary}
                        </Alert>
                      )}

                      <Group gap="xs" mt="xs">
                        <Button
                          size="xs"
                          variant="light"
                          leftSection={<IconSparkles size={14} />}
                          component="a"
                          href={`/monitor/sentry-analysis?id=${issue.id}`}
                          target="_blank"
                        >
                          AI 상세 분석
                        </Button>
                        <Button
                          size="xs"
                          variant="light"
                          leftSection={<IconExternalLink size={14} />}
                          component="a"
                          href={issue.sentryUrl}
                          target="_blank"
                        >
                          Sentry에서 보기
                        </Button>
                      </Group>
                    </Stack>
                  </Card>
                ))}
              </Stack>
            </Paper>
          )}

          {/* 급증 이슈 (급증 지표 제거) */}
          {surgeIssuesDetailed.length > 0 && (
            <Paper p="xl" radius="md" withBorder style={{ borderColor: '#fd7e14', borderWidth: 2 }}>
              <Group mb="md">
                <IconTrendingUp size={24} color="#fd7e14" />
                <Text size="lg" fw={700} c="orange">🔥 급증 이슈 ({surgeIssuesDetailed.length}건)</Text>
              </Group>

              <Stack gap="md">
                {surgeIssuesDetailed.slice(0, 3).map((issue, index) => (
                  <Card key={issue.id} padding="md" radius="md" withBorder>
                    <Stack gap="xs">
                      <Group justify="space-between" wrap="nowrap">
                        <Text size="md" fw={600} style={{ flex: 1 }}>
                          {index + 1}. {issue.title}
                        </Text>
                        {issue.isNew && (
                          <Badge color="cyan" variant="filled">🆕 신규</Badge>
                        )}
                      </Group>

                      <Group gap="md" wrap="wrap">
                        <Badge color="orange" variant="light">
                          💥 {formatNumber(issue.count)}건 (어제 {formatNumber(issue.previousCount)}건)
                        </Badge>
                        {issue.users > 0 && (
                          <Badge color="grape" variant="light">
                            👥 {formatNumber(issue.users)}명
                          </Badge>
                        )}
                      </Group>

                      {/* 급증 지표(배지) 제거됨 */}

                      <Group gap="xs" mt="xs">
                        <Button
                          size="xs"
                          variant="light"
                          leftSection={<IconSparkles size={14} />}
                          component="a"
                          href={`/monitor/sentry-analysis?id=${issue.id}`}
                          target="_blank"
                        >
                          AI 분석
                        </Button>
                        <Button
                          size="xs"
                          variant="light"
                          leftSection={<IconExternalLink size={14} />}
                          component="a"
                          href={issue.sentryUrl}
                          target="_blank"
                        >
                          Sentry
                        </Button>
                      </Group>
                    </Stack>
                  </Card>
                ))}
              </Stack>
            </Paper>
          )}
        </Stack>
      )}

      {/* 최근 7일 크래시 추이 차트 */}
      {selectedReport && (
        <Paper p="xl" radius="md" withBorder mb="lg">
          <Group mb="md">
            <IconChartLine size={24} />
            <Text size="lg" fw={700}>최근 7일 크래시 추이</Text>
          </Group>

          {chartLoading ? (
            <Text c="dimmed" ta="center" py="xl">차트 데이터를 불러오는 중...</Text>
          ) : last7DaysData.length === 0 ? (
            <Text c="dimmed" ta="center" py="xl">최근 7일 데이터가 없습니다</Text>
          ) : (
            <Tabs defaultValue="events">
              <Tabs.List mb="md">
                <Tabs.Tab value="events">이벤트 수</Tabs.Tab>
                <Tabs.Tab value="issues">이슈 수</Tabs.Tab>
                <Tabs.Tab value="users">사용자 수</Tabs.Tab>
                <Tabs.Tab value="crashFreeRate">Crash Free %</Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="events">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={last7DaysData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(date) => format(parseISO(date), 'MM/dd')}
                    />
                    <YAxis />
                    <Tooltip
                      labelFormatter={(date) => format(parseISO(date as string), 'yyyy-MM-dd')}
                      formatter={(value: number) => [`${value}건`, '이벤트']}
                    />
                    <Line
                      type="monotone"
                      dataKey="events"
                      stroke="#8884d8"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </Tabs.Panel>

              <Tabs.Panel value="issues">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={last7DaysData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(date) => format(parseISO(date), 'MM/dd')}
                    />
                    <YAxis />
                    <Tooltip
                      labelFormatter={(date) => format(parseISO(date as string), 'yyyy-MM-dd')}
                      formatter={(value: number) => [`${value}개`, '이슈']}
                    />
                    <Line
                      type="monotone"
                      dataKey="issues"
                      stroke="#a855f7"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </Tabs.Panel>

              <Tabs.Panel value="users">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={last7DaysData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(date) => format(parseISO(date), 'MM/dd')}
                    />
                    <YAxis />
                    <Tooltip
                      labelFormatter={(date) => format(parseISO(date as string), 'yyyy-MM-dd')}
                      formatter={(value: number) => [`${value}명`, '사용자']}
                    />
                    <Line
                      type="monotone"
                      dataKey="users"
                      stroke="#ef4444"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </Tabs.Panel>

              <Tabs.Panel value="crashFreeRate">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={last7DaysData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(date) => format(parseISO(date), 'MM/dd')}
                    />
                    <YAxis
                      domain={[95, 100]}
                      tickFormatter={(value) => `${value}%`}
                    />
                    <Tooltip
                      labelFormatter={(date) => format(parseISO(date as string), 'yyyy-MM-dd')}
                      formatter={(value: number) => [`${value.toFixed(2)}%`, 'Crash Free Rate']}
                    />
                    <Line
                      type="monotone"
                      dataKey="crashFreeRate"
                      stroke="#22c55e"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </Tabs.Panel>
            </Tabs>
          )}

          {selectedReport?.target_date && (
            <Text size="xs" c="dimmed" ta="center" mt="xs">
              ↑ {selectedReport.target_date} (어제)
            </Text>
          )}
        </Paper>
      )}

      {/* 상세 비교 테이블 */}
      {selectedReport && comparisonData && (
        <Paper p="xl" radius="md" withBorder mb="lg">
          <Group mb="md">
            <IconTable size={24} />
            <Text size="lg" fw={700}>상세 비교</Text>
          </Group>

          <Table striped highlightOnHover withTableBorder withColumnBorders>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>지표</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>어제</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>그저께</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>변화</Table.Th>
                <Table.Th style={{ textAlign: 'right' }}>최근 7일 평균</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {/* 이벤트 */}
              <Table.Tr>
                <Table.Td fw={500}>이벤트</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{formatNumber(comparisonData.yesterday.events)}건</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>
                  {comparisonData.dayBefore ? `${formatNumber(comparisonData.dayBefore.events)}건` : '-'}
                </Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>
                  {comparisonData.dayBefore ? (
                    <Badge color={getDeltaColor(comparisonData.deltas.events)} size="md">
                      {formatDeltaPercent(comparisonData.deltas.events)}
                    </Badge>
                  ) : (
                    '-'
                  )}
                </Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>
                  <Group gap={4} justify="flex-end">
                    <Text>{formatNumber(Math.round(comparisonData.avg7Days.events))}건</Text>
                    <Badge
                      size="xs"
                      color={getComparisonColor(comparisonData.yesterday.events, comparisonData.avg7Days.events)}
                    >
                      {formatComparison(comparisonData.yesterday.events, comparisonData.avg7Days.events)}
                    </Badge>
                  </Group>
                </Table.Td>
              </Table.Tr>

              {/* 이슈 */}
              <Table.Tr>
                <Table.Td fw={500}>이슈</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{formatNumber(comparisonData.yesterday.issues)}개</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>
                  {comparisonData.dayBefore ? `${formatNumber(comparisonData.dayBefore.issues)}개` : '-'}
                </Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>
                  {comparisonData.dayBefore ? (
                    <Badge color={getDeltaColor(comparisonData.deltas.issues)} size="md">
                      {formatDeltaPercent(comparisonData.deltas.issues)}
                    </Badge>
                  ) : (
                    '-'
                  )}
                </Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>
                  <Group gap={4} justify="flex-end">
                    <Text>{formatNumber(Math.round(comparisonData.avg7Days.issues))}개</Text>
                    <Badge
                      size="xs"
                      color={getComparisonColor(comparisonData.yesterday.issues, comparisonData.avg7Days.issues)}
                    >
                      {formatComparison(comparisonData.yesterday.issues, comparisonData.avg7Days.issues)}
                    </Badge>
                  </Group>
                </Table.Td>
              </Table.Tr>

              {/* 사용자 */}
              <Table.Tr>
                <Table.Td fw={500}>사용자</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{formatNumber(comparisonData.yesterday.users)}명</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>
                  {comparisonData.dayBefore ? `${formatNumber(comparisonData.dayBefore.users)}명` : '-'}
                </Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>
                  {comparisonData.dayBefore ? (
                    <Badge color={getDeltaColor(comparisonData.deltas.users)} size="md">
                      {formatDeltaPercent(comparisonData.deltas.users)}
                    </Badge>
                  ) : (
                    '-'
                  )}
                </Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>
                  <Group gap={4} justify="flex-end">
                    <Text>{formatNumber(Math.round(comparisonData.avg7Days.users))}명</Text>
                    <Badge
                      size="xs"
                      color={getComparisonColor(comparisonData.yesterday.users, comparisonData.avg7Days.users)}
                    >
                      {formatComparison(comparisonData.yesterday.users, comparisonData.avg7Days.users)}
                    </Badge>
                  </Group>
                </Table.Td>
              </Table.Tr>

              {/* Crash Free Rate */}
              <Table.Tr>
                <Table.Td fw={500}>Crash Free Rate</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>{comparisonData.yesterday.crashFreeRate.toFixed(2)}%</Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>
                  {comparisonData.dayBefore ? `${comparisonData.dayBefore.crashFreeRate.toFixed(2)}%` : '-'}
                </Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>
                  {comparisonData.dayBefore ? (
                    <Badge color={getCrashFreeDeltaColor(comparisonData.deltas.crashFreeRate)} size="md">
                      {comparisonData.deltas.crashFreeRate > 0 ? '+' : ''}{comparisonData.deltas.crashFreeRate.toFixed(2)}%p
                    </Badge>
                  ) : (
                    '-'
                  )}
                </Table.Td>
                <Table.Td style={{ textAlign: 'right' }}>
                  <Group gap={4} justify="flex-end">
                    <Text>{comparisonData.avg7Days.crashFreeRate.toFixed(2)}%</Text>
                    <Badge
                      size="xs"
                      color={getComparisonColor(comparisonData.yesterday.crashFreeRate, comparisonData.avg7Days.crashFreeRate, true)}
                    >
                      {formatComparison(comparisonData.yesterday.crashFreeRate, comparisonData.avg7Days.crashFreeRate)}
                    </Badge>
                  </Group>
                </Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>

          {/* 해석 추가 */}
          <Alert icon={<IconInfoCircle size={16} />} mt="md" color="blue" variant="light">
            💡 {getInterpretation(comparisonData.yesterday, comparisonData.avg7Days)}
          </Alert>
        </Paper>
      )}

      

      {/* 전체 이슈 목록 */}
      <Paper p="xl" radius="md" withBorder mb="lg">
        <Group mb="md" justify="space-between" align="flex-start" wrap="wrap">
          <Group>
            <IconList size={24} />
            <Text size="lg" fw={700}>
              전체 이슈 목록 ({filteredAndSortedIssues.length}개)
            </Text>
          </Group>

          {/* 필터 버튼 */}
          <Group gap="xs" wrap="wrap">
            <Button
              size="xs"
              variant={issueFilter === 'all' ? 'filled' : 'light'}
              onClick={() => setIssueFilter('all')}
            >
              전체 ({issueCountsByFilter.all})
            </Button>
            <Button
              size="xs"
              variant={issueFilter === 'surge' ? 'filled' : 'light'}
              color="orange"
              onClick={() => setIssueFilter('surge')}
              leftSection={<IconTrendingUp size={14} />}
            >
              급증 ({issueCountsByFilter.surge})
            </Button>
            <Button
              size="xs"
              variant={issueFilter === 'new' ? 'filled' : 'light'}
              color="cyan"
              onClick={() => setIssueFilter('new')}
            >
              신규 ({issueCountsByFilter.new})
            </Button>
            <Button
              size="xs"
              variant={issueFilter === 'fatal' ? 'filled' : 'light'}
              color="red"
              onClick={() => setIssueFilter('fatal')}
            >
              Fatal ({issueCountsByFilter.fatal})
            </Button>
          </Group>
        </Group>

        {/* 정렬 옵션 */}
        <Group mb="md">
          <Text size="sm" c="dimmed">정렬:</Text>
          <Select
            size="xs"
            value={issueSortBy}
            onChange={(value) => setIssueSortBy(value as SortOption)}
            data={[
              { value: 'count', label: '발생 건수 순' },
              { value: 'users', label: '영향 사용자 순' },
              { value: 'growth', label: '증가율 순' }
            ]}
            style={{ width: 150 }}
          />
        </Group>

        {/* 이슈 목록 */}
        {isLoading && !selectedReport ? (
          <Text c="dimmed" ta="center" py="xl">불러오는 중…</Text>
        ) : !selectedReport ? (
          <Text c="dimmed" ta="center" py="xl">표시할 리포트가 없습니다.</Text>
        ) : filteredAndSortedIssues.length === 0 ? (
          <Text c="dimmed" ta="center" py="xl">표시할 이슈가 없습니다.</Text>
        ) : (
          <Stack gap="md">
            {pagedIssues.map((issue, index) => (
              <Card key={issue.id} padding="md" radius="md" withBorder>
                <Stack gap="xs">
                  {/* 제목 및 배지 */}
                  <Group justify="space-between" wrap="nowrap" align="flex-start">
                    <Group gap="xs" style={{ flex: 1, minWidth: 0 }}>
                      <Text size="sm" c="dimmed" fw={500} style={{ flexShrink: 0 }}>
                        {((issuePage - 1) * PAGE_SIZE) + index + 1}.
                      </Text>
                      <Text size="md" fw={600} style={{ flex: 1, wordBreak: 'break-word' }}>
                        {issue.title || '<unknown>'}
                      </Text>
                    </Group>

                    <Group gap={4} style={{ flexShrink: 0 }}>
                      {issue.isNew && (
                        <Badge size="sm" color="cyan" variant="filled">🆕</Badge>
                      )}
                      {issue.isSurge && (
                        <Badge size="sm" color="orange" variant="filled">🔥</Badge>
                      )}
                      {issue.level === 'fatal' && (
                        <Badge size="sm" color="red" variant="filled">⚠️ Fatal</Badge>
                      )}
                    </Group>
                  </Group>

                  {/* 통계 */}
                  <Group gap="md" wrap="wrap">
                    <Badge variant="light" color="blue">
                      💥 {formatNumber(issue.count)}건 ({formatDeltaPercent(issue.delta)})
                    </Badge>
                    <Badge variant="light" color="grape">
                      👥 {formatNumber(issue.users)}명
                    </Badge>
                    {issue.percentage > 0 && (
                      <Badge variant="light" color="gray">
                        📊 전체의 {issue.percentage.toFixed(1)}%
                      </Badge>
                    )}
                  </Group>

                  {/* 최근 7일 평균 */}
                  {issue.avg7Days && (
                    <Text size="xs" c="dimmed">
                      최근 7일 평균: {formatNumber(issue.avg7Days)}건
                    </Text>
                  )}

                  {/* AI 짧은 요약 (있으면) */}
                  {issue.aiNote && (
                    <Text size="sm" c="dimmed" lineClamp={2}>
                      🤖 {issue.aiNote}
                    </Text>
                  )}

                  {/* 액션 버튼 */}
                  <Group gap="xs" mt="xs" wrap="wrap">
                    <Button
                      size="xs"
                      variant="light"
                      leftSection={<IconSparkles size={14} />}
                      component="a"
                      href={`/monitor/sentry-analysis?id=${issue.id}`}
                      target="_blank"
                    >
                      AI 분석
                    </Button>
                    <Button
                      size="xs"
                      variant="light"
                      leftSection={<IconExternalLink size={14} />}
                      component="a"
                      href={issue.sentryUrl}
                      target="_blank"
                    >
                      Sentry
                    </Button>
                    <Button
                      size="xs"
                      variant="subtle"
                      leftSection={<IconHistory size={14} />}
                      onClick={() => handleShowHistory(issue.id)}
                    >
                      히스토리
                    </Button>
                  </Group>
                </Stack>
              </Card>
            ))}

            {Math.ceil(filteredAndSortedIssues.length / PAGE_SIZE) > 1 && (
              <Group justify="center" mt="sm">
                <Pagination
                  total={Math.ceil(filteredAndSortedIssues.length / PAGE_SIZE)}
                  value={issuePage}
                  onChange={setIssuePage}
                  size="sm"
                  radius="md"
                />
              </Group>
            )}
          </Stack>
        )}
      </Paper>

      {/* 리포트 실행 결과 섹션 */}
      {selectedReport && (
        <Card withBorder radius="lg" p="lg" mt="lg" style={{ backgroundColor: 'rgba(99, 102, 241, 0.02)' }} data-testid="report-details-section">
          <Group justify="space-between" align="center" mb="lg">
            <div>
              <SectionToggle open={expandedSections.report} onClick={() => toggleSection('report')} label="📋 리포트 실행 결과" />
              <Text size="xs" c="dimmed" mt={2}>
                리포트 생성 과정 및 결과 상세 정보
              </Text>
            </div>
          </Group>

          {expandedSections.report && (
            <>
              {/* 실행 정보 카드 */}
              <Grid mb="lg">
            <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
              <Card withBorder p="md" style={{ backgroundColor: 'var(--mantine-color-dark-6)', minHeight: '80px' }}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={4}>실행 상태</Text>
                <Text fw={600} c={selectedReport.status === 'success' ? 'green.6' : selectedReport.status === 'error' ? 'red.6' : 'yellow.6'}>
                  {selectedReport.status === 'success' ? '✅ 성공' : selectedReport.status === 'error' ? '❌ 실패' : '🔄 실행중'}
                </Text>
              </Card>
            </Grid.Col>

            <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
              <Card withBorder p="md" style={{ backgroundColor: 'var(--mantine-color-dark-6)', minHeight: '80px' }}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={4}>실행 방식</Text>
                <Text fw={600} c="blue.6">
                  {selectedReport.trigger_type === 'scheduled' ? '🤖 자동' : '🧪 수동'}
                </Text>
              </Card>
            </Grid.Col>

            <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
              <Card withBorder p="md" style={{ backgroundColor: 'var(--mantine-color-dark-6)', minHeight: '80px' }}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={4}>실행 시간</Text>
                <Text fw={600} c="violet.6">
                  {formatExecutionTime(selectedReport.execution_time_ms)}
                </Text>
              </Card>
            </Grid.Col>

            <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
              <Card withBorder p="md" style={{ backgroundColor: 'var(--mantine-color-dark-6)', minHeight: '80px' }}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={4}>Slack 전송</Text>
                <Text fw={600} c={selectedReport.slack_sent ? 'green.6' : 'red.6'}>
                  {selectedReport.slack_sent ? '✅ 성공' : '❌ 실패'}
                </Text>
              </Card>
            </Grid.Col>
          </Grid>

          {/* 오류 메시지 */}
          {selectedReport.error_message && (
            <Alert icon={<IconAlertTriangle size={16} />} color="red" mb="lg">
              <Text fw={600} mb={4}>오류 메시지</Text>
              <Text size="sm">{selectedReport.error_message}</Text>
            </Alert>
          )}

          {/* 실행 로그 */}
          {Array.isArray(selectedReport.execution_logs) && selectedReport.execution_logs.length > 0 && (
            <Card withBorder p="md" mb="lg" style={{ backgroundColor: 'var(--mantine-color-dark-6)' }}>
              <SectionToggle open={expandedSections.logs} onClick={() => toggleSection('logs')} label="실행 로그" />
              {expandedSections.logs && (
                <pre
                  style={{
                    marginTop: 8,
                    padding: 12,
                    borderRadius: 8,
                    fontSize: 11,
                    overflow: 'auto',
                    maxHeight: 400,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    background: 'var(--mantine-color-dark-7)',
                    color: 'var(--mantine-color-gray-3)',
                  }}
                >
                  {(selectedReport.execution_logs as string[]).join('\n')}
                </pre>
              )}
            </Card>
          )}

          {/* 리포트 데이터 */}
          {selectedReport.result_data && (
            <Card withBorder p="md" mb="lg" style={{ backgroundColor: 'var(--mantine-color-dark-6)' }}>
              <SectionToggle open={expandedSections.data} onClick={() => toggleSection('data')} label="리포트 원본 데이터" />
              {expandedSections.data && (
                <pre
                  style={{
                    marginTop: 8,
                    padding: 12,
                    borderRadius: 8,
                    fontSize: 12,
                    overflow: 'auto',
                    maxHeight: 300,
                    background: 'var(--mantine-color-dark-7)',
                    color: 'var(--mantine-color-gray-3)',
                  }}
                >
                  {JSON.stringify(selectedReport.result_data, null, 2)}
                </pre>
              )}
            </Card>
          )}

          {/* Slack 미리보기 */}
          {selectedReport.result_data && (
            <Card withBorder p="md" style={{ backgroundColor: 'var(--mantine-color-dark-6)' }}>
              <SectionToggle open={expandedSections.slack} onClick={() => toggleSection('slack')} label="Slack 메시지 미리보기" />
              {expandedSections.slack && (
                <Card withBorder radius="md" p="md" mt={8} style={{ backgroundColor: 'var(--mantine-color-gray-1)' }}>
                  {(() => {
                    const blocks = (selectedReport.result_data as any)?.slack_blocks
                    if (Array.isArray(blocks) && blocks.length > 0) {
                      return <SlackPreview blocks={blocks} />
                    }
                    return <Text c="dimmed" size="sm">Slack 메시지 미리보기를 생성할 수 없습니다.</Text>
                  })()}
                </Card>
              )}
            </Card>
          )}
            </>
          )}
        </Card>
      )}

      {/* 이슈 분석 모달 */}
      <Modal opened={issueModal.open} onClose={handleCloseIssueModal} title="이슈 상세 분석" size="lg" centered>
        {issueModal.item && (
          <Stack gap="sm">
            <Text fw={600}>{issueModal.item.title}</Text>
            <Text c="dimmed" size="sm">
              📈 {formatNumber(issueModal.item.events)}건{issueModal.item.users != null ? ` · 👥 ${formatNumber(issueModal.item.users)}명` : ''}
            </Text>
            <div>
              <Text fw={600} size="sm">AI 분석 결과</Text>
              <div style={{ marginTop: 8 }}>
                {issueAnalysis?.summary ? (
                  <Text style={{ lineHeight: 1.6 }}>{renderAnalysis(issueAnalysis.summary) as any}</Text>
                ) : (
                  <Text c="dimmed" size="sm">아직 분석되지 않았습니다. 아래의 &quot;AI 분석&quot; 버튼을 눌러 분석을 실행하세요.</Text>
                )}
              </div>
            </div>
            <Group gap={8}>
              {issueModal.item.link && (
                <Button component="a" href={issueModal.item.link} target="_blank" variant="light">
                  Sentry에서 열기
                </Button>
              )}
              <Button onClick={() => runIssueAnalysis(!!issueAnalysis?.summary)} loading={issueLoading} color="green">
                {issueAnalysis?.summary ? 'AI 재분석' : 'AI 분석'}
              </Button>
            </Group>
            {issueError && (
              <Text c="red">⚠️ {issueError}</Text>
            )}
          </Stack>
        )}
      </Modal>

      {/* 삭제 확인 모달 */}
      <Modal opened={deleteModal} onClose={() => setDeleteModal(false)} title="리포트 삭제 확인" size="sm" centered>
        <Stack gap="md">
          <Text>
            정말로 이 리포트를 삭제하시겠습니까?
          </Text>
          <Text size="sm" c="dimmed">
            <strong>{selectedReport?.target_date}</strong> {platform.toUpperCase()} 일간 리포트
          </Text>
          <Text size="sm" c="red">
            ⚠️ 삭제된 리포트는 복구할 수 없습니다.
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => setDeleteModal(false)}>
              취소
            </Button>
            <Button color="red" onClick={handleDeleteReport} loading={deleting}>
              삭제
            </Button>
          </Group>
        </Stack>
      </Modal>

    </div>
  )
}
