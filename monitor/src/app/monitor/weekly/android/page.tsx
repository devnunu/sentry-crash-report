'use client'

import WeeklyReportPage from '../WeeklyReportPage'

export default function WeeklyAndroidReportPage() {
  return (
    <WeeklyReportPage
      platform="android"
      title="🤖 Android 주간 리포트"
      description="Android 플랫폼의 Sentry 주간 크래시 리포트를 확인합니다."
      cardTitle="🏅 Android Top 5 이슈"
    />
  )
}
