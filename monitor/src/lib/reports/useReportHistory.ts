import { useCallback, useEffect, useState } from 'react'
import type { Platform } from '@/lib/types'
import type { ReportExecution } from './types'

type ReportType = 'daily' | 'weekly'

type HistoryResponse = {
  success: boolean
  data?: {
    reports: ReportExecution[]
    total?: number
    limit?: number
    offset?: number
  }
  error?: string
}

export interface ReportHistoryState {
  reports: ReportExecution[]
  selectedReport: ReportExecution | null
  selectedIndex: number
  isLoading: boolean
  error: string
  hasOlder: boolean
  hasNewer: boolean
  goOlder: () => void
  goNewer: () => void
  goToDate: (targetDate: string) => boolean
  refresh: () => Promise<void>
}

interface UseReportHistoryOptions {
  reportType: ReportType
  platform: Platform
  limit?: number
}

export function useReportHistory({ reportType, platform, limit = 20 }: UseReportHistoryOptions): ReportHistoryState {
  const [reports, setReports] = useState<ReportExecution[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const fetchHistory = useCallback(async () => {
    setIsLoading(true)
    setError('')

    try {
      const params = new URLSearchParams({
        limit: String(limit),
        platform,
      })

      const response = await fetch(`/api/reports/${reportType}/history?${params.toString()}`, {
        cache: 'no-store',
      })

      if (!response.ok) {
        throw new Error(`리포트 히스토리를 불러오지 못했습니다. (HTTP ${response.status})`)
      }

      const result = (await response.json()) as HistoryResponse

      if (!result.success || !result.data) {
        throw new Error(result.error || '리포트 데이터를 불러오지 못했습니다.')
      }

      const sorted = [...result.data.reports].sort((a, b) => (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ))

      setReports(sorted)
      setSelectedIndex(0)
    } catch (err) {
      const message = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
      setError(message)
      setReports([])
      setSelectedIndex(0)
    } finally {
      setIsLoading(false)
    }
  }, [limit, platform, reportType])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  useEffect(() => {
    setSelectedIndex((idx) => {
      if (reports.length === 0) return 0
      return Math.min(idx, reports.length - 1)
    })
  }, [reports.length])

  const goOlder = useCallback(() => {
    setSelectedIndex((idx) => {
      if (idx >= reports.length - 1) return idx
      return idx + 1
    })
  }, [reports.length])

  const goNewer = useCallback(() => {
    setSelectedIndex((idx) => {
      if (idx <= 0) return 0
      return idx - 1
    })
  }, [])

  const goToDate = useCallback((targetDate: string) => {
    const targetIndex = reports.findIndex(report => report.target_date === targetDate)
    if (targetIndex >= 0) {
      setSelectedIndex(targetIndex)
      return true
    }
    return false
  }, [reports])

  const selectedReport = reports[selectedIndex] ?? null
  const hasOlder = selectedIndex < reports.length - 1
  const hasNewer = selectedIndex > 0

  return {
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
    refresh: fetchHistory,
  }
}
