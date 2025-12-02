// Alert Rules 평가 엔진

import {
  AlertCategory,
  AlertCondition,
  AlertMetric,
  AlertRule,
  METRIC_METADATA,
  OPERATOR_METADATA
} from './types/alert-rules';
import {alertRulesDb} from './database/alert-rules';

// 리포트 데이터에서 Metric 값 추출
export function getMetricValue(data: any, metric: AlertMetric): number {
  const metricMap: Record<AlertMetric, (d: any) => number> = {
    total_crashes: (d) => d.totalCrashes || d.cumulative?.totalCrashes || d.events || 0,
    unique_issues: (d) => d.uniqueIssues || d.cumulative?.uniqueIssues || d.issues || 0,
    affected_users: (d) => d.affectedUsers || d.cumulative?.affectedUsers || d.users || 0,
    new_issues: (d) => {
      if (Array.isArray(d.newIssues)) return d.newIssues.length;
      if (d.topIssues && Array.isArray(d.topIssues)) {
        return d.topIssues.filter((i: any) => i.isNew).length;
      }
      return d.newIssues || 0;
    },
    fatal_issues: (d) => {
      if (Array.isArray(d.fatalIssues)) return d.fatalIssues.length;
      if (d.topIssues && Array.isArray(d.topIssues)) {
        return d.topIssues.filter((i: any) => i.level === 'fatal').length;
      }
      return d.fatalIssues || 0;
    },
    fatal_issues_with_min_events: (d) => {
      // 이 함수는 params.minEvents가 필요하므로 evaluateCondition에서 직접 처리
      return 0;
    },
    change_pct: (d) => Math.abs(d.changePct || d.comparisonPct || 0),
    daily_avg_crashes: (d) => d.dailyAvgCrashes || d.avgCrashesPerDay || 0
  };

  return metricMap[metric]?.(data) ?? 0;
}

// 조건 평가
export function evaluateCondition(condition: AlertCondition, data: any): boolean {
  // fatal_issues_with_min_events는 특별 처리
  if (condition.metric === 'fatal_issues_with_min_events') {
    const minEvents = condition.params?.minEvents || 10; // 기본값 10

    // topIssues에서 fatal이면서 eventCount >= minEvents인 이슈 개수 계산
    let fatalIssuesCount = 0;

    if (data.topIssues && Array.isArray(data.topIssues)) {
      fatalIssuesCount = data.topIssues.filter(
        (issue: any) => issue.level === 'fatal' && (issue.eventCount || issue.count || 0) >= minEvents
      ).length;
    } else if (data.fatalIssues && Array.isArray(data.fatalIssues)) {
      fatalIssuesCount = data.fatalIssues.filter(
        (issue: any) => (issue.eventCount || issue.count || 0) >= minEvents
      ).length;
    }

    // threshold와 비교
    switch (condition.operator) {
      case 'gte':
        return fatalIssuesCount >= condition.threshold;
      case 'gt':
        return fatalIssuesCount > condition.threshold;
      case 'lte':
        return fatalIssuesCount <= condition.threshold;
      case 'lt':
        return fatalIssuesCount < condition.threshold;
      case 'eq':
        return fatalIssuesCount === condition.threshold;
      default:
        return false;
    }
  }

  const value = getMetricValue(data, condition.metric);
  const threshold = condition.threshold;

  switch (condition.operator) {
    case 'gte':
      return value >= threshold;
    case 'gt':
      return value > threshold;
    case 'lte':
      return value <= threshold;
    case 'lt':
      return value < threshold;
    case 'eq':
      return value === threshold;
    default:
      return false;
  }
}

// 규칙 평가
export function evaluateRule(rule: AlertRule, data: any): boolean {
  if (!rule.enabled) return false;
  if (rule.conditions.length === 0) return false;

  const results = rule.conditions.map((condition) => evaluateCondition(condition, data));

  // AND: 모든 조건 만족
  if (rule.conditionOperator === 'AND') {
    return results.every((r) => r === true);
  }

  // OR: 하나라도 만족
  return results.some((r) => r === true);
}

// 심각도 판정
export async function calculateSeverity(
  category: AlertCategory,
  data: any
): Promise<{ severity: 'normal' | 'warning' | 'critical'; matchedRule?: AlertRule; reasons: string[] }> {
  // 해당 카테고리의 활성화된 규칙 가져오기
  const rules = await getAlertRules(category);

  // Critical 규칙 먼저 평가
  const criticalRule = rules.find((r) => r.severity === 'critical');
  if (criticalRule && evaluateRule(criticalRule, data)) {
    const reasons = getMatchedConditions(criticalRule, data);
    return { severity: 'critical', matchedRule: criticalRule, reasons };
  }

  // Warning 규칙 평가
  const warningRule = rules.find((r) => r.severity === 'warning');
  if (warningRule && evaluateRule(warningRule, data)) {
    const reasons = getMatchedConditions(warningRule, data);
    return { severity: 'warning', matchedRule: warningRule, reasons };
  }

  return { severity: 'normal', reasons: [] };
}

// 만족한 조건들 추출
function getMatchedConditions(rule: AlertRule, data: any): string[] {
  return rule.conditions
    .filter((condition) => evaluateCondition(condition, data))
    .map((condition) => {
      const metadata = METRIC_METADATA[condition.metric];
      const op = OPERATOR_METADATA[condition.operator];
      const unit = metadata.unit === 'count' ? (metadata.label.includes('이슈') ? '개' : '건') : '%';

      // fatal_issues_with_min_events는 특별 처리
      if (condition.metric === 'fatal_issues_with_min_events') {
        const minEvents = condition.params?.minEvents || 10;
        let fatalIssuesCount = 0;

        if (data.topIssues && Array.isArray(data.topIssues)) {
          fatalIssuesCount = data.topIssues.filter(
            (issue: any) => issue.level === 'fatal' && (issue.eventCount || issue.count || 0) >= minEvents
          ).length;
        } else if (data.fatalIssues && Array.isArray(data.fatalIssues)) {
          fatalIssuesCount = data.fatalIssues.filter(
            (issue: any) => (issue.eventCount || issue.count || 0) >= minEvents
          ).length;
        }

        return `${metadata.label} (${minEvents}건 이상) ${op.symbol} ${condition.threshold}${unit} (실제: ${fatalIssuesCount}${unit})`;
      }

      const value = getMetricValue(data, condition.metric);
      return `${metadata.label} ${op.symbol} ${condition.threshold}${unit} (실제: ${value}${unit})`;
    });
}

// 규칙 설명 생성
export function generateRuleDescription(rule: AlertRule): string {
  const operator = rule.conditionOperator === 'AND' ? '모두' : '하나라도';
  const action = rule.severity === 'critical' ? '긴급' : '주의';

  const conditions = rule.conditions
    .sort((a, b) => a.position - b.position)
    .map((condition) => {
      const metadata = METRIC_METADATA[condition.metric];
      const op = OPERATOR_METADATA[condition.operator];
      const unit = metadata.unit === 'count' ? (metadata.label.includes('이슈') ? '개' : '건') : '%';

      // fatal_issues_with_min_events는 특별 처리
      if (condition.metric === 'fatal_issues_with_min_events') {
        const minEvents = condition.params?.minEvents || 10;
        return `• ${metadata.label} (${minEvents}건 이상) ${op.symbol} ${condition.threshold}${unit}`;
      }

      return `• ${metadata.label} ${op.symbol} ${condition.threshold}${unit}`;
    });

  return `다음 조건 중 ${operator} 만족하면 ${action} (${rule.conditionOperator}):\n${conditions.join('\n')}`;
}

// 데이터베이스에서 규칙 가져오기 (wrapper function)
export async function getAlertRules(category?: AlertCategory): Promise<AlertRule[]> {
  return alertRulesDb.getAlertRules(category);
}
