'use client'

import DailyReportPage from '../DailyReportPage'

export default function DailyAndroidReportPage() {
  return (
    <DailyReportPage
      platform="android"
      title="🤖 Android 일간 리포트"
      description="Android 플랫폼의 Sentry 일간 크래시 리포트를 생성하고 관리합니다."
      cardTitle="🏅 Android Top 5 이슈"
    />
  )
}
