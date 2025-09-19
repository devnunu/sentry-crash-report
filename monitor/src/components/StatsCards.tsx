'use client'

import { Paper, SimpleGrid, Text } from '@mantine/core'

type Item = { label: string; value: number | string; color?: string }

export default function StatsCards({ items }: { items: Item[] }) {
  return (
    <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md" mt="sm">
      {items.map((it, i) => (
        <Paper key={i} withBorder p="md" radius="md">
          <Text size="xs" c="dimmed" mb={4}>{it.label}</Text>
          <Text size="lg" fw={700} c={it.color as any}>{it.value}</Text>
        </Paper>
      ))}
    </SimpleGrid>
  )
}

