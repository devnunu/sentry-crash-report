'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  AppShell,
  Container,
  Group,
  Text,
  SegmentedControl,
  ActionIcon,
  Menu,
  Burger
} from '@mantine/core';
import {
  IconRocket,
  IconSettings,
  IconBell,
  IconKey,
  IconHelp
} from '@tabler/icons-react';

interface HeaderProps {
  opened: boolean;
  toggle: () => void;
}

export function Header({ opened, toggle }: HeaderProps) {
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');

  return (
    <AppShell.Header>
      <Container size="xl" h="100%">
        <Group h="100%" justify="space-between">
          {/* 로고 & 타이틀 */}
          <Group gap="md">
            <Burger
              opened={opened}
              onClick={toggle}
              hiddenFrom="sm"
              size="sm"
            />
            <Link href="/monitor" style={{ textDecoration: 'none', color: 'inherit' }}>
              <Group gap="xs">
                <IconRocket size={28} />
                <Text size="xl" fw={700} visibleFrom="sm">
                  Sentry Release Monitoring
                </Text>
              </Group>
            </Link>
          </Group>

          {/* 플랫폼 선택기 */}
          <SegmentedControl
            value={selectedPlatform}
            onChange={setSelectedPlatform}
            data={[
              { label: '전체', value: 'all' },
              {
                label: 'Android',
                value: 'android'
              },
              {
                label: 'iOS',
                value: 'ios'
              }
            ]}
            size="xs"
            visibleFrom="md"
          />

          {/* 우측 액션 */}
          <Group gap="xs">
            {/* 설정 메뉴 */}
            <Menu shadow="md" width={200}>
              <Menu.Target>
                <ActionIcon variant="subtle" size="lg">
                  <IconSettings size={20} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>설정</Menu.Label>
                <Menu.Item
                  leftSection={<IconBell size={16} />}
                  component={Link}
                  href="/settings/alert-rules"
                >
                  Alert Rules
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconKey size={16} />}
                  component={Link}
                  href="/monitor/settings/env"
                >
                  환경 변수
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  leftSection={<IconHelp size={16} />}
                  component="a"
                  href="https://docs.sentry.io"
                  target="_blank"
                >
                  도움말
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </Container>
    </AppShell.Header>
  );
}
