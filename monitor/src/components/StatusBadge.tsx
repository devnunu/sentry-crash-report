'use client'

import { Badge } from '@mantine/core'

type Props = {
  kind: 'monitor' | 'report'
  status: string
}

export default function StatusBadge({ kind, status }: Props) {
  let color: string = 'gray'
  let label: string = status

  if (kind === 'monitor') {
    switch (status) {
      case 'active':
        color = 'green'; label = '활성'; break
      case 'stopped':
        color = 'red'; label = '중단됨'; break
      case 'expired':
        color = 'gray'; label = '만료됨'; break
    }
  } else if (kind === 'report') {
    switch (status) {
      case 'success':
        color = 'green'; label = '성공'; break
      case 'error':
        color = 'red'; label = '실패'; break
      case 'running':
        color = 'yellow'; label = '실행중'; break
    }
  }

  return (
    <Badge color={color} variant="light" radius="sm">{label}</Badge>
  )
}

