'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function DailyReportPage() {
  const router = useRouter()

  useEffect(() => {
    // 기본적으로 Android 일간 리포트로 리다이렉트
    router.replace('/monitor/daily/android')
  }, [router])

  return null
}