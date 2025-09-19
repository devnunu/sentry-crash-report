'use client'

import { MantineProvider, createTheme } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import React from 'react'

const theme = createTheme({
  primaryColor: 'blue',
  focusRing: 'auto',
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, "Noto Sans", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
  fontFamilyMonospace: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  colors: {
    dark: [
      '#C1C2C5',
      '#A6A7AB',
      '#909296',
      '#5c5f66',
      '#373A40',
      '#2C2E33',
      '#25262b',
      '#1A1B1E',
      '#141517',
      '#101113',
    ],
  },
  components: {
    Card: {
      defaultProps: {
        withBorder: true,
        radius: 'lg',
        padding: 'lg',
      },
    },
    Button: {
      defaultProps: {
        radius: 'md',
      },
    },
    Table: {
      defaultProps: {
        highlightOnHover: true,
        withColumnBorders: true,
        verticalSpacing: 'xs',
      },
    },
    Paper: {
      defaultProps: {
        withBorder: true,
        radius: 'md',
      },
    },
  },
})

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <Notifications position="top-right" limit={3} />
      {children}
    </MantineProvider>
  )
}

