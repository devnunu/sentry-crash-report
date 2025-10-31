'use client';

import { AppShell, Container } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { Breadcrumb } from './Breadcrumb';

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const [opened, { toggle }] = useDisclosure();

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{
        width: 280,
        breakpoint: 'sm',
        collapsed: { mobile: !opened }
      }}
      padding="md"
    >
      <Header opened={opened} toggle={toggle} />
      <Sidebar />

      <AppShell.Main>
        <Container size="xl" py="md">
          <Breadcrumb />
          {children}
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
