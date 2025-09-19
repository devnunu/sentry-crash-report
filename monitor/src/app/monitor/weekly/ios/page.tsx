'use client'

import WeeklyReportPage from '../WeeklyReportPage'

export default function WeeklyIosReportPage() {
  return (
    <WeeklyReportPage
      platform="ios"
      title="🍎 iOS 주간 리포트"
      description="iOS 플랫폼의 Sentry 주간 크래시 리포트를 확인합니다."
      cardTitle="🏅 iOS Top 5 이슈"
    />
  )
}
