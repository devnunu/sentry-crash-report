'use client'

import { Button } from '@mantine/core'

export default function SectionToggle({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return (
    <Button variant="subtle" onClick={onClick} style={{ paddingLeft: 0 }}>
      {open ? '▼' : '▶'} {label}
    </Button>
  )
}

