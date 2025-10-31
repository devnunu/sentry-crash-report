'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Container,
  Stack,
  Title,
  Text,
  Paper,
  Group,
  Badge,
  Button,
  Card,
  ActionIcon,
  Modal,
  Select,
  NumberInput,
  Radio,
  Divider,
  Alert,
  Checkbox,
  Loader,
  TextInput
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconEdit,
  IconTrash,
  IconPlus,
  IconInfoCircle,
  IconAlertTriangle,
  IconAlertCircle
} from '@tabler/icons-react';
import {
  AlertRule,
  AlertCondition,
  AlertCategory,
  AlertMetric,
  AlertOperator,
  METRIC_METADATA,
  OPERATOR_METADATA,
  CATEGORY_LABELS
} from '@/lib/types/alert-rules';
import { generateRuleDescription } from '@/lib/alert-engine';

export default function AlertRulesPage() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const [modalOpened, setModalOpened] = useState(false);
  const [createModalOpened, setCreateModalOpened] = useState(false);
  const [newRuleCategory, setNewRuleCategory] = useState<AlertCategory | null>(null);
  const [newRuleSeverity, setNewRuleSeverity] = useState<'warning' | 'critical' | null>(null);

  // 규칙 목록 가져오기
  const fetchRules = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/alert-rules');
      const data = await response.json();
      if (data.success) {
        setRules(data.data.rules);
      }
    } catch (error) {
      console.error('Failed to fetch rules:', error);
      notifications.show({
        color: 'red',
        title: '오류',
        message: '규칙 목록을 불러오는데 실패했습니다'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRules();
  }, []);

  // 카테고리별 그룹화
  const rulesByCategory = useMemo(() => {
    return {
      daily: rules.filter((r) => r.category === 'daily'),
      weekly: rules.filter((r) => r.category === 'weekly'),
      'version-monitor': rules.filter((r) => r.category === 'version-monitor')
    };
  }, [rules]);

  // 규칙 편집
  const handleEdit = (rule: AlertRule) => {
    setEditingRule(rule);
    setModalOpened(true);
  };

  // 규칙 삭제
  const handleDelete = async (id: string) => {
    if (!confirm('이 규칙을 삭제하시겠습니까?')) return;

    try {
      const response = await fetch(`/api/alert-rules/${id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        notifications.show({
          color: 'green',
          title: '성공',
          message: '규칙이 삭제되었습니다'
        });
        fetchRules();
      }
    } catch (error) {
      console.error('Failed to delete rule:', error);
      notifications.show({
        color: 'red',
        title: '오류',
        message: '규칙 삭제에 실패했습니다'
      });
    }
  };

  // 규칙 토글
  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      const response = await fetch(`/api/alert-rules/${id}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });

      if (response.ok) {
        notifications.show({
          color: 'green',
          title: '성공',
          message: `규칙이 ${enabled ? '활성화' : '비활성화'}되었습니다`
        });
        fetchRules();
      }
    } catch (error) {
      console.error('Failed to toggle rule:', error);
      notifications.show({
        color: 'red',
        title: '오류',
        message: '규칙 상태 변경에 실패했습니다'
      });
    }
  };

  // 규칙 저장
  const handleSave = async (updatedRule: AlertRule) => {
    try {
      const response = await fetch(`/api/alert-rules/${updatedRule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: updatedRule.name,
          enabled: updatedRule.enabled,
          conditionOperator: updatedRule.conditionOperator,
          conditions: updatedRule.conditions.map((c, index) => ({
            metric: c.metric,
            operator: c.operator,
            threshold: c.threshold,
            position: index
          }))
        })
      });

      if (response.ok) {
        notifications.show({
          color: 'green',
          title: '성공',
          message: '규칙이 저장되었습니다'
        });
        setModalOpened(false);
        setEditingRule(null);
        fetchRules();
      }
    } catch (error) {
      console.error('Failed to save rule:', error);
      notifications.show({
        color: 'red',
        title: '오류',
        message: '규칙 저장에 실패했습니다'
      });
    }
  };

  // 규칙 생성
  const handleCreate = async (newRule: {
    name: string;
    category: AlertCategory;
    severity: 'warning' | 'critical';
    enabled: boolean;
    conditionOperator: 'AND' | 'OR';
    conditions: Array<{
      metric: string;
      operator: string;
      threshold: number;
      position: number;
    }>;
  }) => {
    try {
      const response = await fetch('/api/alert-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRule)
      });

      if (response.ok) {
        notifications.show({
          color: 'green',
          title: '성공',
          message: '규칙이 생성되었습니다'
        });
        setCreateModalOpened(false);
        setNewRuleCategory(null);
        setNewRuleSeverity(null);
        fetchRules();
      }
    } catch (error) {
      console.error('Failed to create rule:', error);
      notifications.show({
        color: 'red',
        title: '오류',
        message: '규칙 생성에 실패했습니다'
      });
    }
  };

  // 규칙 생성 모달 열기
  const openCreateModal = (category: AlertCategory, severity: 'warning' | 'critical') => {
    setNewRuleCategory(category);
    setNewRuleSeverity(severity);
    setCreateModalOpened(true);
  };

  if (loading) {
    return (
      <Container size="xl" py="xl">
        <Stack align="center" justify="center" h={400}>
          <Loader size="lg" />
          <Text c="dimmed">규칙을 불러오는 중...</Text>
        </Stack>
      </Container>
    );
  }

  return (
    <Container size="xl" py="xl">
      <Stack gap="xl">
        {/* 헤더 */}
        <div>
          <Title order={2}>🔔 알림 규칙 (Alert Rules)</Title>
          <Text c="dimmed">리포트의 상태(정상/주의/긴급)를 결정하는 규칙을 설정합니다.</Text>
        </div>

        {/* 안내 메시지 */}
        <Alert icon={<IconInfoCircle />} color="blue" variant="light">
          <Text size="sm">
            각 카테고리(일간/주간/버전별)마다 Warning과 Critical 규칙을 설정할 수 있습니다.
            <br />
            조건을 충족하면 해당 심각도로 알림이 발송됩니다.
          </Text>
        </Alert>

        {/* 카테고리별 규칙 */}
        <Stack gap="lg">
          {/* 버전별 모니터링 */}
          <RuleCategorySection
            title="🚀 버전별 모니터링"
            category="version-monitor"
            rules={rulesByCategory['version-monitor']}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onToggle={handleToggle}
            onCreate={openCreateModal}
          />

          {/* 일간 리포트 */}
          <RuleCategorySection
            title="📊 일간 리포트"
            category="daily"
            rules={rulesByCategory.daily}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onToggle={handleToggle}
            onCreate={openCreateModal}
          />

          {/* 주간 리포트 */}
          <RuleCategorySection
            title="📅 주간 리포트"
            category="weekly"
            rules={rulesByCategory.weekly}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onToggle={handleToggle}
            onCreate={openCreateModal}
          />
        </Stack>
      </Stack>

      {/* 편집 모달 */}
      {editingRule && (
        <RuleEditModal
          rule={editingRule}
          opened={modalOpened}
          onClose={() => {
            setModalOpened(false);
            setEditingRule(null);
          }}
          onSave={handleSave}
        />
      )}

      {/* 생성 모달 */}
      {newRuleCategory && newRuleSeverity && (
        <RuleCreateModal
          category={newRuleCategory}
          severity={newRuleSeverity}
          opened={createModalOpened}
          onClose={() => {
            setCreateModalOpened(false);
            setNewRuleCategory(null);
            setNewRuleSeverity(null);
          }}
          onCreate={handleCreate}
        />
      )}
    </Container>
  );
}

// 카테고리 섹션 컴포넌트
interface RuleCategorySectionProps {
  title: string;
  category: AlertCategory;
  rules: AlertRule[];
  onEdit: (rule: AlertRule) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onCreate: (category: AlertCategory, severity: 'warning' | 'critical') => void;
}

function RuleCategorySection({
  title,
  category,
  rules,
  onEdit,
  onDelete,
  onToggle,
  onCreate
}: RuleCategorySectionProps) {
  const criticalRule = rules.find((r) => r.severity === 'critical');
  const warningRule = rules.find((r) => r.severity === 'warning');

  return (
    <Paper p="xl" radius="md" withBorder>
      <Group mb="md">
        <Text size="lg" fw={700}>
          {title}
        </Text>
      </Group>

      <Stack gap="md">
        {/* Critical 규칙 */}
        {criticalRule ? (
          <RuleCard rule={criticalRule} onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} />
        ) : (
          <Card withBorder padding="lg">
            <Group justify="space-between">
              <Text c="dimmed" size="sm">
                Critical 규칙이 설정되지 않았습니다
              </Text>
              <Button
                size="xs"
                variant="light"
                color="red"
                leftSection={<IconPlus size={14} />}
                onClick={() => onCreate(category, 'critical')}
              >
                Critical 규칙 추가
              </Button>
            </Group>
          </Card>
        )}

        {/* Warning 규칙 */}
        {warningRule ? (
          <RuleCard rule={warningRule} onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} />
        ) : (
          <Card withBorder padding="lg">
            <Group justify="space-between">
              <Text c="dimmed" size="sm">
                Warning 규칙이 설정되지 않았습니다
              </Text>
              <Button
                size="xs"
                variant="light"
                color="orange"
                leftSection={<IconPlus size={14} />}
                onClick={() => onCreate(category, 'warning')}
              >
                Warning 규칙 추가
              </Button>
            </Group>
          </Card>
        )}
      </Stack>
    </Paper>
  );
}

// 규칙 카드 컴포넌트
interface RuleCardProps {
  rule: AlertRule;
  onEdit: (rule: AlertRule) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
}

function RuleCard({ rule, onEdit, onDelete, onToggle }: RuleCardProps) {
  const icon = rule.severity === 'critical' ? <IconAlertCircle /> : <IconAlertTriangle />;
  const color = rule.severity === 'critical' ? 'red' : 'orange';

  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" mb="md">
        <Group>
          <Text size="lg" fw={600}>
            {rule.severity === 'critical' ? '🚨 긴급' : '⚠️ 주의'} (
            {rule.severity === 'critical' ? 'Critical' : 'Warning'})
          </Text>
          <Badge color={rule.enabled ? 'green' : 'gray'}>
            {rule.enabled ? '활성화' : '비활성화'}
          </Badge>
        </Group>
        <Group gap="xs">
          <ActionIcon
            variant="light"
            onClick={() => onToggle(rule.id, !rule.enabled)}
            title={rule.enabled ? '비활성화' : '활성화'}
          >
            {rule.enabled ? '⏸' : '▶️'}
          </ActionIcon>
          <ActionIcon variant="light" onClick={() => onEdit(rule)}>
            <IconEdit size={16} />
          </ActionIcon>
          <ActionIcon variant="light" color="red" onClick={() => onDelete(rule.id)}>
            <IconTrash size={16} />
          </ActionIcon>
        </Group>
      </Group>

      <Text size="sm" style={{ whiteSpace: 'pre-line' }}>
        {generateRuleDescription(rule)}
      </Text>
    </Card>
  );
}

// 규칙 편집 모달
interface RuleEditModalProps {
  rule: AlertRule;
  opened: boolean;
  onClose: () => void;
  onSave: (rule: AlertRule) => void;
}

function RuleEditModal({ rule, opened, onClose, onSave }: RuleEditModalProps) {
  const [conditions, setConditions] = useState<AlertCondition[]>(rule.conditions);
  const [conditionOperator, setConditionOperator] = useState(rule.conditionOperator);
  const [enabled, setEnabled] = useState(rule.enabled);

  // 조건 추가
  const addCondition = () => {
    setConditions([
      ...conditions,
      {
        id: crypto.randomUUID(),
        ruleId: rule.id,
        metric: 'total_crashes',
        operator: 'gte',
        threshold: 100,
        position: conditions.length
      }
    ]);
  };

  // 저장
  const handleSave = () => {
    onSave({
      ...rule,
      conditions,
      conditionOperator,
      enabled
    });
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Text fw={700} size="lg">
          알림 규칙 편집 — {CATEGORY_LABELS[rule.category]}{' '}
          {rule.severity === 'critical' ? 'Critical' : 'Warning'}
        </Text>
      }
      size="xl"
    >
      <Stack gap="md">
        {/* 조건 연산자 */}
        <Radio.Group
          label="조건 연산자"
          value={conditionOperator}
          onChange={(value) => setConditionOperator(value as 'AND' | 'OR')}
        >
          <Stack gap="xs" mt="xs">
            <Radio value="OR" label="OR - 하나라도 만족하면 알림" />
            <Radio value="AND" label="AND - 모두 만족해야 알림" />
          </Stack>
        </Radio.Group>

        <Divider />

        {/* 조건 목록 */}
        <div>
          <Group justify="space-between" mb="sm">
            <Text fw={500}>조건 목록</Text>
            <Button size="xs" leftSection={<IconPlus size={14} />} onClick={addCondition}>
              조건 추가
            </Button>
          </Group>

          <Stack gap="sm">
            {conditions.map((condition, index) => (
              <ConditionEditor
                key={condition.id}
                condition={condition}
                index={index}
                category={rule.category}
                onChange={(updated) => {
                  const newConditions = [...conditions];
                  newConditions[index] = updated;
                  setConditions(newConditions);
                }}
                onDelete={() => {
                  setConditions(conditions.filter((_, i) => i !== index));
                }}
              />
            ))}
          </Stack>
        </div>

        {/* 미리보기 */}
        <Alert icon={<IconInfoCircle />} color="blue">
          <Text size="sm" fw={500} mb="xs">
            💡 미리보기
          </Text>
          <Text size="sm" style={{ whiteSpace: 'pre-line' }}>
            {generateRuleDescription({
              ...rule,
              conditions,
              conditionOperator
            })}
          </Text>
        </Alert>

        {/* 활성화 */}
        <Checkbox label="이 규칙 활성화" checked={enabled} onChange={(e) => setEnabled(e.currentTarget.checked)} />

        {/* 버튼 */}
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>
            취소
          </Button>
          <Button onClick={handleSave}>저장</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// 조건 에디터
interface ConditionEditorProps {
  condition: AlertCondition;
  index: number;
  category: AlertCategory;
  onChange: (condition: AlertCondition) => void;
  onDelete: () => void;
}

function ConditionEditor({ condition, index, category, onChange, onDelete }: ConditionEditorProps) {
  // 해당 카테고리에 적용 가능한 Metric만 필터링
  const availableMetrics = Object.values(METRIC_METADATA).filter((m) =>
    m.applicableTo.includes(category)
  );

  return (
    <Card withBorder padding="sm">
      <Stack gap="xs">
        <Group justify="space-between">
          <Text size="sm" fw={500}>
            조건 {index + 1}
          </Text>
          <ActionIcon size="sm" color="red" variant="subtle" onClick={onDelete}>
            <IconTrash size={14} />
          </ActionIcon>
        </Group>

        <Group grow>
          {/* Metric 선택 */}
          <Select
            data={availableMetrics.map((m) => ({
              value: m.key,
              label: `${m.label} (${m.unit === 'count' ? '건/개' : '%'})`
            }))}
            value={condition.metric}
            onChange={(value) => onChange({ ...condition, metric: value as AlertMetric })}
          />

          {/* Operator 선택 */}
          <Select
            data={Object.entries(OPERATOR_METADATA).map(([key, meta]) => ({
              value: key,
              label: meta.label
            }))}
            value={condition.operator}
            onChange={(value) => onChange({ ...condition, operator: value as AlertOperator })}
          />

          {/* Threshold 입력 */}
          <NumberInput
            value={condition.threshold}
            onChange={(value) => onChange({ ...condition, threshold: Number(value) })}
            min={0}
            step={1}
          />
        </Group>
      </Stack>
    </Card>
  );
}

// 규칙 생성 모달
interface RuleCreateModalProps {
  category: AlertCategory;
  severity: 'warning' | 'critical';
  opened: boolean;
  onClose: () => void;
  onCreate: (rule: {
    name: string;
    category: AlertCategory;
    severity: 'warning' | 'critical';
    enabled: boolean;
    conditionOperator: 'AND' | 'OR';
    conditions: Array<{
      metric: string;
      operator: string;
      threshold: number;
      position: number;
    }>;
  }) => void;
}

function RuleCreateModal({ category, severity, opened, onClose, onCreate }: RuleCreateModalProps) {
  const [name, setName] = useState(`${CATEGORY_LABELS[category]} - ${severity === 'critical' ? '긴급' : '주의'}`);
  const [conditions, setConditions] = useState<AlertCondition[]>([
    {
      id: crypto.randomUUID(),
      ruleId: '',
      metric: 'total_crashes',
      operator: 'gte',
      threshold: 100,
      position: 0
    }
  ]);
  const [conditionOperator, setConditionOperator] = useState<'AND' | 'OR'>('OR');
  const [enabled, setEnabled] = useState(true);

  // 조건 추가
  const addCondition = () => {
    setConditions([
      ...conditions,
      {
        id: crypto.randomUUID(),
        ruleId: '',
        metric: 'total_crashes',
        operator: 'gte',
        threshold: 100,
        position: conditions.length
      }
    ]);
  };

  // 저장
  const handleCreate = () => {
    onCreate({
      name,
      category,
      severity,
      enabled,
      conditionOperator,
      conditions: conditions.map((c, index) => ({
        metric: c.metric,
        operator: c.operator,
        threshold: c.threshold,
        position: index
      }))
    });
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Text fw={700} size="lg">
          새 알림 규칙 생성 — {CATEGORY_LABELS[category]}{' '}
          {severity === 'critical' ? 'Critical' : 'Warning'}
        </Text>
      }
      size="xl"
    >
      <Stack gap="md">
        {/* 규칙 이름 */}
        <TextInput
          label="규칙 이름"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        {/* 조건 연산자 */}
        <Radio.Group
          label="조건 연산자"
          value={conditionOperator}
          onChange={(value) => setConditionOperator(value as 'AND' | 'OR')}
        >
          <Stack gap="xs" mt="xs">
            <Radio value="OR" label="OR - 하나라도 만족하면 알림" />
            <Radio value="AND" label="AND - 모두 만족해야 알림" />
          </Stack>
        </Radio.Group>

        <Divider />

        {/* 조건 목록 */}
        <div>
          <Group justify="space-between" mb="sm">
            <Text fw={500}>조건 목록</Text>
            <Button size="xs" leftSection={<IconPlus size={14} />} onClick={addCondition}>
              조건 추가
            </Button>
          </Group>

          <Stack gap="sm">
            {conditions.map((condition, index) => (
              <ConditionEditor
                key={condition.id}
                condition={condition}
                index={index}
                category={category}
                onChange={(updated) => {
                  const newConditions = [...conditions];
                  newConditions[index] = updated;
                  setConditions(newConditions);
                }}
                onDelete={() => {
                  if (conditions.length > 1) {
                    setConditions(conditions.filter((_, i) => i !== index));
                  } else {
                    notifications.show({
                      color: 'orange',
                      message: '최소 1개 이상의 조건이 필요합니다'
                    });
                  }
                }}
              />
            ))}
          </Stack>
        </div>

        {/* 미리보기 */}
        <Alert icon={<IconInfoCircle />} color="blue">
          <Text size="sm" fw={500} mb="xs">
            💡 미리보기
          </Text>
          <Text size="sm" style={{ whiteSpace: 'pre-line' }}>
            {generateRuleDescription({
              id: '',
              name,
              category,
              severity,
              enabled,
              conditionOperator,
              conditions,
              createdAt: '',
              updatedAt: ''
            })}
          </Text>
        </Alert>

        {/* 활성화 */}
        <Checkbox label="이 규칙 활성화" checked={enabled} onChange={(e) => setEnabled(e.currentTarget.checked)} />

        {/* 버튼 */}
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>
            취소
          </Button>
          <Button onClick={handleCreate} disabled={!name.trim() || conditions.length === 0}>
            생성
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
