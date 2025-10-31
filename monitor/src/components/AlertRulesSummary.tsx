'use client';

import React, { useState, useEffect } from 'react';
import { Alert, Stack, Text, Group, Button, Collapse, Loader, Badge } from '@mantine/core';
import { IconInfoCircle, IconChevronDown, IconChevronUp, IconSettings } from '@tabler/icons-react';
import type { AlertRule, AlertCategory } from '@/lib/types/alert-rules';
import { generateRuleDescription } from '@/lib/alert-engine';

interface AlertRulesSummaryProps {
  category: AlertCategory;
  title?: string;
}

export default function AlertRulesSummary({ category, title }: AlertRulesSummaryProps) {
  const [opened, setOpened] = useState(false);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRules = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/alert-rules?category=${category}`);
        const data = await response.json();
        if (data.success) {
          setRules(data.data.rules);
        }
      } catch (error) {
        console.error('Failed to fetch alert rules:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchRules();
  }, [category]);

  const criticalRule = rules.find((r) => r.severity === 'critical');
  const warningRule = rules.find((r) => r.severity === 'warning');

  return (
    <Alert
      icon={<IconInfoCircle size={20} />}
      title={
        <Group gap="xs" style={{ cursor: 'pointer' }} onClick={() => setOpened(!opened)}>
          <Text fw={600}>{title || '현재 적용 중인 알림 기준'}</Text>
          {opened ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
        </Group>
      }
      color="blue"
      variant="light"
    >
      <Collapse in={opened}>
        <Stack gap="md" mt="sm">
          {loading ? (
            <Group gap="xs">
              <Loader size="xs" />
              <Text size="sm" c="dimmed">
                규칙을 불러오는 중...
              </Text>
            </Group>
          ) : (
            <>
              {/* Critical 규칙 */}
              <div>
                <Group gap="xs" mb="xs">
                  <Text fw={600} size="sm">
                    🚨 긴급 (Critical)
                  </Text>
                  <Badge size="xs" color={criticalRule?.enabled ? 'green' : 'gray'}>
                    {criticalRule?.enabled ? '활성화' : '비활성화'}
                  </Badge>
                </Group>
                {criticalRule ? (
                  <Text size="xs" c="dimmed" style={{ whiteSpace: 'pre-line' }} pl="md">
                    {generateRuleDescription(criticalRule)}
                  </Text>
                ) : (
                  <Text size="xs" c="dimmed" pl="md">
                    설정된 규칙이 없습니다
                  </Text>
                )}
              </div>

              {/* Warning 규칙 */}
              <div>
                <Group gap="xs" mb="xs">
                  <Text fw={600} size="sm">
                    ⚠️ 주의 (Warning)
                  </Text>
                  <Badge size="xs" color={warningRule?.enabled ? 'green' : 'gray'}>
                    {warningRule?.enabled ? '활성화' : '비활성화'}
                  </Badge>
                </Group>
                {warningRule ? (
                  <Text size="xs" c="dimmed" style={{ whiteSpace: 'pre-line' }} pl="md">
                    {generateRuleDescription(warningRule)}
                  </Text>
                ) : (
                  <Text size="xs" c="dimmed" pl="md">
                    설정된 규칙이 없습니다
                  </Text>
                )}
              </div>

              {/* 안내 및 이동 버튼 */}
              <Alert color="gray" variant="light" p="xs">
                <Stack gap="xs">
                  <Text size="xs" c="dimmed">
                    💡 이 기준은 <strong>알림 규칙</strong> 페이지에서 자유롭게 수정할 수 있습니다.
                  </Text>
                  <Group>
                    <Button
                      component="a"
                      href="/settings/alert-rules"
                      size="xs"
                      variant="light"
                      leftSection={<IconSettings size={14} />}
                    >
                      알림 규칙 설정으로 이동
                    </Button>
                  </Group>
                </Stack>
              </Alert>
            </>
          )}
        </Stack>
      </Collapse>
    </Alert>
  );
}
