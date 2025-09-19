'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function WeeklyReportPage() {
  const router = useRouter()

  useEffect(() => {
    // 기본적으로 Android 주간 리포트로 리다이렉트
    router.replace('/monitor/weekly/android')
  }, [router])

  return null
}