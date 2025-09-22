'use client'

import dynamic from 'next/dynamic'
import { Suspense } from 'react'
import LoadingScreen from '@/components/LoadingScreen'
import { IconBrandAndroid } from '@tabler/icons-react'

const WeeklyReportComponent = dynamic(() => import('@/components/WeeklyReportComponent'), {
  ssr: false,
  loading: () => (
    <LoadingScreen
      icon={<IconBrandAndroid size={32} color="green" />}
      title="Android 주간 리포트 로딩 중..."
      subtitle="최신 리포트 데이터를 불러오고 있습니다"
    />
  )
})

export default function WeeklyAndroidReportPage() {
  return (
    <Suspense fallback={
      <LoadingScreen
        icon={<IconBrandAndroid size={32} color="green" />}
        title="Android 주간 리포트 로딩 중..."
        subtitle="최신 리포트 데이터를 불러오고 있습니다"
      />
    }>
      <WeeklyReportComponent platform="android" />
    </Suspense>
  )
}
