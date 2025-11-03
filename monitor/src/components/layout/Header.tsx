'use client';

import Link from 'next/link';
import {
  AppShell,
  Container,
  Group,
  Text,
  Burger
} from '@mantine/core';
import {
  IconRocket
} from '@tabler/icons-react';

interface HeaderProps {
  opened: boolean;
  toggle: () => void;
}

export function Header({ opened, toggle }: HeaderProps) {
  return (
    <AppShell.Header>
      <Container size="xl" h="100%">
        <Group h="100%">
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
        </Group>
      </Container>
    </AppShell.Header>
  );
}
