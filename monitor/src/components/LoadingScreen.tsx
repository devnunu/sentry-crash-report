'use client'

import React from 'react'
import { Group, Stack, Text } from '@mantine/core'

interface LoadingScreenProps {
  icon: React.ReactNode
  title: string
  subtitle?: string
  minHeight?: string
}

export default function LoadingScreen({ 
  icon, 
  title, 
  subtitle = "최신 리포트 데이터를 분석하고 있습니다",
  minHeight = "400px"
}: LoadingScreenProps) {
  return (
    <div className="container">
      <Group justify="center" align="center" style={{ minHeight }}>
        <Stack align="center" gap="md">
          {icon}
          <Text size="lg">{title}</Text>
          <Text size="sm" c="dimmed">{subtitle}</Text>
        </Stack>
      </Group>
    </div>
  )
}