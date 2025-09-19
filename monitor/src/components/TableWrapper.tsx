'use client'

import { ScrollArea } from '@mantine/core'
import React from 'react'

export default function TableWrapper({ children, minWidth = 900 }: { children: React.ReactNode; minWidth?: number }) {
  return (
    <div className="table-mobile-cards" style={{ marginTop: 16 }}>
      <ScrollArea>
        <div style={{ minWidth }}>
          {children}
        </div>
      </ScrollArea>
    </div>
  )
}

