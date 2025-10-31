import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import './globals.css'
import Providers from './providers'
import { AppLayout } from '@/components/layout/AppLayout'
import type React from 'react'
import { ColorSchemeScript } from '@mantine/core'

export const metadata = {
  title: 'Sentry Release Monitoring',
  description: 'Release monitoring control UI',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <ColorSchemeScript defaultColorScheme="dark" />
      </head>
      <body suppressHydrationWarning>
        <Providers>
          <AppLayout>
            {children}
          </AppLayout>
        </Providers>
      </body>
    </html>
  )
}
