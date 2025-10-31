-- Alert Rules 테이블
CREATE TABLE IF NOT EXISTS alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL,  -- 'daily', 'weekly', 'version-monitor'
  severity VARCHAR(20) NOT NULL,  -- 'warning', 'critical'
  enabled BOOLEAN DEFAULT true,
  condition_operator VARCHAR(10) NOT NULL,  -- 'AND', 'OR'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by VARCHAR(255)
);

-- Alert Conditions 테이블
CREATE TABLE IF NOT EXISTS alert_conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID REFERENCES alert_rules(id) ON DELETE CASCADE,
  metric VARCHAR(50) NOT NULL,  -- 'total_crashes', 'unique_issues', etc.
  operator VARCHAR(10) NOT NULL,  -- 'gte', 'gt', 'lte', 'lt', 'eq'
  threshold DECIMAL NOT NULL,
  position INTEGER NOT NULL,  -- 조건 순서
  created_at TIMESTAMP DEFAULT NOW()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_alert_rules_category ON alert_rules(category);
CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules(enabled);
CREATE INDEX IF NOT EXISTS idx_alert_conditions_rule_id ON alert_conditions(rule_id);

-- 기본 규칙 삽입
INSERT INTO alert_rules (name, category, severity, enabled, condition_operator, created_by)
VALUES
  ('버전별 모니터링 - Critical 알림', 'version-monitor', 'critical', true, 'OR', 'system'),
  ('버전별 모니터링 - Warning 알림', 'version-monitor', 'warning', true, 'OR', 'system')
ON CONFLICT DO NOTHING;

-- 기본 조건 삽입 (Critical)
INSERT INTO alert_conditions (rule_id, metric, operator, threshold, position)
SELECT
  id,
  unnest(ARRAY['unique_issues', 'fatal_issues', 'total_crashes']) as metric,
  'gte' as operator,
  unnest(ARRAY[20, 5, 500]) as threshold,
  unnest(ARRAY[0, 1, 2]) as position
FROM alert_rules
WHERE category = 'version-monitor' AND severity = 'critical'
ON CONFLICT DO NOTHING;

-- 기본 조건 삽입 (Warning)
INSERT INTO alert_conditions (rule_id, metric, operator, threshold, position)
SELECT
  id,
  unnest(ARRAY['unique_issues', 'fatal_issues', 'total_crashes']) as metric,
  'gte' as operator,
  unnest(ARRAY[10, 3, 100]) as threshold,
  unnest(ARRAY[0, 1, 2]) as position
FROM alert_rules
WHERE category = 'version-monitor' AND severity = 'warning'
ON CONFLICT DO NOTHING;
