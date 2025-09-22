'use client'

import dynamic from 'next/dynamic'
import { Suspense } from 'react'
import LoadingScreen from '@/components/LoadingScreen'
import { IconBrandAndroid } from '@tabler/icons-react'

const DailyReportComponent = dynamic(() => import('@/components/DailyReportComponent'), {
  ssr: false,
  loading: () => (
    <LoadingScreen
      icon={<IconBrandAndroid size={32} color="green" />}
      title="Android 일간 리포트 로딩 중..."
      subtitle="최신 리포트 데이터를 불러오고 있습니다"
    />
  )
})

export default function DailyAndroidReportPage() {
  return (
    <Suspense fallback={
      <LoadingScreen
        icon={<IconBrandAndroid size={32} color="green" />}
        title="Android 일간 리포트 로딩 중..."
        subtitle="최신 리포트 데이터를 불러오고 있습니다"
      />
    }>
      <DailyReportComponent platform="android" />
    </Suspense>
  )
}
