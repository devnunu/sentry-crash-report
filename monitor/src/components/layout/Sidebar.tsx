'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { AppShell, Stack, Text, NavLink, ScrollArea } from '@mantine/core';
import {
  IconRocket,
  IconCalendar,
  IconCalendarEvent,
  IconSearch,
  IconBell,
  IconSettings,
  IconPlaystationTriangle,
  IconClock,
  IconHistory,
  IconVariable,
  IconBrandAndroid,
  IconBrandApple,
  IconFileAnalytics,
  IconRobot
} from '@tabler/icons-react';

export function Sidebar() {
  const pathname = usePathname();

  const navGroups = [
    {
      label: '모니터링',
      items: [
        {
          label: '버전별 모니터링',
          icon: IconRocket,
          href: '/monitor',
          active: pathname === '/monitor'
        },
        {
          label: '리포트 실행 내역',
          icon: IconHistory,
          href: '/monitor/history',
          active: pathname.startsWith('/monitor/history')
        },
        {
          label: 'Sentry 이슈 분석',
          icon: IconSearch,
          href: '/monitor/sentry-analysis',
          active: pathname.startsWith('/monitor/sentry-analysis')
        }
      ]
    },
    {
      label: '리포트',
      items: [
        {
          label: '일간 리포트',
          icon: IconCalendar,
          children: [
            {
              label: 'Android',
              icon: IconBrandAndroid,
              href: '/monitor/daily/android',
              active: pathname.startsWith('/monitor/daily/android')
            },
            {
              label: 'iOS',
              icon: IconBrandApple,
              href: '/monitor/daily/ios',
              active: pathname.startsWith('/monitor/daily/ios')
            }
          ]
        },
        {
          label: '주간 리포트',
          icon: IconCalendarEvent,
          children: [
            {
              label: 'Android',
              icon: IconBrandAndroid,
              href: '/monitor/weekly/android',
              active: pathname.startsWith('/monitor/weekly/android')
            },
            {
              label: 'iOS',
              icon: IconBrandApple,
              href: '/monitor/weekly/ios',
              active: pathname.startsWith('/monitor/weekly/ios')
            }
          ]
        }
      ]
    },
    {
      label: '설정',
      items: [
        {
          label: '테스트 실행',
          icon: IconPlaystationTriangle,
          children: [
            {
              label: '리포트 테스트',
              icon: IconFileAnalytics,
              href: '/monitor/settings/test/report',
              active: pathname.startsWith('/monitor/settings/test/report')
            },
            {
              label: '모니터링 테스트',
              icon: IconRobot,
              href: '/monitor/settings/test/monitor',
              active: pathname.startsWith('/monitor/settings/test/monitor')
            }
          ]
        },
        {
          label: '자동 스케줄',
          icon: IconClock,
          href: '/monitor/settings/schedule',
          active: pathname.startsWith('/monitor/settings/schedule')
        },
        {
          label: 'Alert Rules',
          icon: IconBell,
          href: '/settings/alert-rules',
          active: pathname.startsWith('/settings/alert-rules')
        },
        {
          label: '환경 변수',
          icon: IconVariable,
          href: '/monitor/settings/env',
          active: pathname.startsWith('/monitor/settings/env')
        }
      ]
    }
  ];

  return (
    <AppShell.Navbar p="md">
      <AppShell.Section grow component={ScrollArea}>
        <Stack gap="lg">
          {navGroups.map((group) => (
            <div key={group.label}>
              <Text size="xs" fw={700} c="dimmed" mb="xs" tt="uppercase">
                {group.label}
              </Text>
              <Stack gap={2}>
                {group.items.map((item) => {
                  if (item.children) {
                    return (
                      <NavLink
                        key={item.label}
                        label={item.label}
                        leftSection={item.icon && <item.icon size={18} />}
                        childrenOffset={28}
                        opened={item.children.some((child) => child.active)}
                      >
                        {item.children.map((child) => (
                          <NavLink
                            key={child.href}
                            label={child.label}
                            leftSection={child.icon && <child.icon size={14} />}
                            component={Link}
                            href={child.href}
                            active={child.active}
                          />
                        ))}
                      </NavLink>
                    );
                  }

                  return (
                    <NavLink
                      key={item.href}
                      label={item.label}
                      leftSection={item.icon && <item.icon size={18} />}
                      component={Link}
                      href={item.href!}
                      active={item.active}
                    />
                  );
                })}
              </Stack>
            </div>
          ))}
        </Stack>
      </AppShell.Section>
    </AppShell.Navbar>
  );
}
