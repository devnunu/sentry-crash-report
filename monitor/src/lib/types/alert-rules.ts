// Alert Rules 타입 정의

export type AlertMetric =
  | 'total_crashes'
  | 'unique_issues'
  | 'affected_users'
  | 'crash_free_rate'
  | 'crash_free_session_rate'
  | 'new_issues'
  | 'fatal_issues'
  | 'fatal_issues_with_min_events' // n개 이상 발생한 fatal 이슈가 m개 이상
  | 'change_pct'
  | 'daily_avg_crashes';

export type AlertOperator = 'gte' | 'gt' | 'lte' | 'lt' | 'eq';

export type AlertCategory = 'daily' | 'weekly' | 'version-monitor';

export type AlertSeverity = 'warning' | 'critical';

export type ConditionOperator = 'AND' | 'OR';

export interface AlertRule {
  id: string;
  name: string;
  category: AlertCategory;
  severity: AlertSeverity;
  enabled: boolean;
  conditionOperator: ConditionOperator;
  conditions: AlertCondition[];
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export interface AlertCondition {
  id: string;
  ruleId: string;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  params?: Record<string, any>; // 추가 파라미터 (예: minEvents)
  position: number;
}

export interface MetricMetadata {
  key: AlertMetric;
  label: string;
  description: string;
  unit: 'count' | 'percentage';
  applicableTo: AlertCategory[];
}

// Metric 메타데이터
export const METRIC_METADATA: Record<AlertMetric, MetricMetadata> = {
  total_crashes: {
    key: 'total_crashes',
    label: '총 크래시',
    description: '전체 크래시 이벤트 수',
    unit: 'count',
    applicableTo: ['daily', 'weekly', 'version-monitor']
  },
  unique_issues: {
    key: 'unique_issues',
    label: '고유 이슈',
    description: '유니크한 이슈의 개수',
    unit: 'count',
    applicableTo: ['daily', 'weekly', 'version-monitor']
  },
  affected_users: {
    key: 'affected_users',
    label: '영향받은 사용자',
    description: '크래시를 경험한 사용자 수',
    unit: 'count',
    applicableTo: ['daily', 'weekly', 'version-monitor']
  },
  crash_free_rate: {
    key: 'crash_free_rate',
    label: 'Crash Free Rate',
    description: '크래시 없는 사용자 비율',
    unit: 'percentage',
    applicableTo: ['daily', 'weekly', 'version-monitor']
  },
  crash_free_session_rate: {
    key: 'crash_free_session_rate',
    label: 'Crash Free Session',
    description: '크래시 없는 세션 비율',
    unit: 'percentage',
    applicableTo: ['version-monitor']
  },
  new_issues: {
    key: 'new_issues',
    label: '신규 이슈',
    description: '새로 발생한 이슈 개수',
    unit: 'count',
    applicableTo: ['daily', 'weekly', 'version-monitor']
  },
  fatal_issues: {
    key: 'fatal_issues',
    label: 'Fatal 이슈',
    description: 'Fatal 레벨 이슈 개수',
    unit: 'count',
    applicableTo: ['daily', 'weekly', 'version-monitor']
  },
  fatal_issues_with_min_events: {
    key: 'fatal_issues_with_min_events',
    label: '높은 발생 빈도 Fatal 이슈',
    description: '특정 이벤트 수 이상 발생한 Fatal 이슈 개수',
    unit: 'count',
    applicableTo: ['daily', 'weekly', 'version-monitor']
  },
  change_pct: {
    key: 'change_pct',
    label: '변화율',
    description: '이전 대비 변화율 (%)',
    unit: 'percentage',
    applicableTo: ['daily', 'weekly']
  },
  daily_avg_crashes: {
    key: 'daily_avg_crashes',
    label: '일평균 크래시',
    description: '하루 평균 크래시 수',
    unit: 'count',
    applicableTo: ['weekly']
  }
};

// Operator 메타데이터
export const OPERATOR_METADATA: Record<AlertOperator, { label: string; symbol: string }> = {
  gte: { label: '≥ (이상)', symbol: '≥' },
  gt: { label: '> (초과)', symbol: '>' },
  lte: { label: '≤ (이하)', symbol: '≤' },
  lt: { label: '< (미만)', symbol: '<' },
  eq: { label: '= (같음)', symbol: '=' }
};

// Category 레이블
export const CATEGORY_LABELS: Record<AlertCategory, string> = {
  'daily': '일간 리포트',
  'weekly': '주간 리포트',
  'version-monitor': '버전별 모니터링'
};
