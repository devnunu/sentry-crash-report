'use client'

import DailyReportPage from '../DailyReportPage'

export default function DailyIosReportPage() {
  return (
    <DailyReportPage
      platform="ios"
      title="🍎 iOS 일간 리포트"
      description="iOS 플랫폼의 Sentry 일간 크래시 리포트를 생성하고 관리합니다."
      cardTitle="🏅 iOS Top 5 이슈"
    />
  )
}
