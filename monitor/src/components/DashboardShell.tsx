'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AppShell, Burger, Group, Title, ScrollArea, NavLink, Box } from '@mantine/core'
import { IconActivity, IconCalendarStats, IconDeviceMobile, IconSettings, IconPlaystationTriangle } from '@tabler/icons-react'

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const [opened, setOpened] = React.useState(false)
  const [settingsOpened, setSettingsOpened] = React.useState(false)
  const pathname = usePathname()
  
  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" gap="sm" justify="space-between">
          <Group gap="sm">
            <Burger opened={opened} onClick={() => setOpened((o) => !o)} hiddenFrom="sm" size="sm" />
            <Title order={4}>Sentry Release Monitoring</Title>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <AppShell.Section grow component={ScrollArea}>
          <Box>
            <NavLink
              component={Link}
              href="/monitor"
              label="모니터"
              leftSection={<IconActivity size={16} />}
              active={pathname === '/monitor'}
            />
            <NavLink
              component={Link}
              href="/monitor/daily"
              label="일간 리포트"
              leftSection={<IconDeviceMobile size={16} />}
              active={pathname?.startsWith('/monitor/daily')}
            />
            <NavLink
              component={Link}
              href="/monitor/weekly"
              label="주간 리포트"
              leftSection={<IconCalendarStats size={16} />}
              active={pathname?.startsWith('/monitor/weekly')}
            />
            <NavLink
              label="설정"
              leftSection={<IconSettings size={16} />}
              opened={settingsOpened}
              onClick={() => setSettingsOpened(!settingsOpened)}
              childrenOffset={28}
            >
              <NavLink
                component={Link}
                href="/monitor/settings/test"
                label="테스트 실행"
                leftSection={<IconPlaystationTriangle size={14} />}
                active={pathname?.startsWith('/monitor/settings/test')}
              />
            </NavLink>
          </Box>
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>
        {children}
      </AppShell.Main>
    </AppShell>
  )
}

