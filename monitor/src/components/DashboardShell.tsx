'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AppShell, Burger, Group, Title, ScrollArea, NavLink, Box } from '@mantine/core'
import { IconActivity, IconCalendarStats, IconDeviceMobile, IconSettings, IconPlaystationTriangle, IconClock, IconBrandAndroid, IconBrandApple, IconHistory, IconVariable } from '@tabler/icons-react'

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const [opened, setOpened] = React.useState(false)
  const [settingsOpened, setSettingsOpened] = React.useState(false)
  const [dailyOpened, setDailyOpened] = React.useState(false)
  const [weeklyOpened, setWeeklyOpened] = React.useState(false)
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
              label="버전별 모니터링"
              leftSection={<IconActivity size={16} />}
              active={pathname === '/monitor'}
            />
            <NavLink
              label="일간 리포트"
              leftSection={<IconDeviceMobile size={16} />}
              opened={dailyOpened}
              onClick={() => setDailyOpened(!dailyOpened)}
              childrenOffset={28}
            >
              <NavLink
                component={Link}
                href="/monitor/daily/android"
                label="Android"
                leftSection={<IconBrandAndroid size={14} />}
                active={pathname?.startsWith('/monitor/daily/android')}
              />
              <NavLink
                component={Link}
                href="/monitor/daily/ios"
                label="iOS"
                leftSection={<IconBrandApple size={14} />}
                active={pathname?.startsWith('/monitor/daily/ios')}
              />
            </NavLink>
            <NavLink
              label="주간 리포트"
              leftSection={<IconCalendarStats size={16} />}
              opened={weeklyOpened}
              onClick={() => setWeeklyOpened(!weeklyOpened)}
              childrenOffset={28}
            >
              <NavLink
                component={Link}
                href="/monitor/weekly/android"
                label="Android"
                leftSection={<IconBrandAndroid size={14} />}
                active={pathname?.startsWith('/monitor/weekly/android')}
              />
              <NavLink
                component={Link}
                href="/monitor/weekly/ios"
                label="iOS"
                leftSection={<IconBrandApple size={14} />}
                active={pathname?.startsWith('/monitor/weekly/ios')}
              />
            </NavLink>
            <NavLink
              component={Link}
              href="/monitor/history"
              label="리포트 실행 내역"
              leftSection={<IconHistory size={16} />}
              active={pathname?.startsWith('/monitor/history')}
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
              <NavLink
                component={Link}
                href="/monitor/settings/schedule"
                label="자동 스케줄"
                leftSection={<IconClock size={14} />}
                active={pathname?.startsWith('/monitor/settings/schedule')}
              />
              <NavLink
                component={Link}
                href="/monitor/settings/env"
                label="환경 변수"
                leftSection={<IconVariable size={14} />}
                active={pathname?.startsWith('/monitor/settings/env')}
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

