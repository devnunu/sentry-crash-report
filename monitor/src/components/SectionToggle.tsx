'use client'

import { Text } from '@mantine/core'

export default function SectionToggle({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return (
    <Text 
      onClick={onClick} 
      style={{ 
        cursor: 'pointer', 
        userSelect: 'none',
        textAlign: 'left',
        fontSize: '14px',
        fontWeight: 600
      }}
      c="dimmed"
    >
      {open ? '▼' : '▶'} {label}
    </Text>
  )
}

