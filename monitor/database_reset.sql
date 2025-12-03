-- ============================================
-- Sentry Crash Report Monitor - 데이터베이스 리셋 쿼리
-- 모든 테이블 삭제 후 새로 생성
-- 실행 전 주의: 모든 데이터가 삭제됩니다!
-- ============================================

-- ============================================
-- 1. 기존 테이블 및 관련 객체 삭제
-- ============================================

-- 트리거 삭제
DROP TRIGGER IF EXISTS update_monitor_sessions_updated_at ON monitor_sessions;
DROP TRIGGER IF EXISTS update_report_settings_updated_at ON report_settings;
DROP TRIGGER IF EXISTS update_issue_analyses_updated_at ON issue_analyses;
DROP TRIGGER IF EXISTS update_alert_rules_updated_at ON alert_rules;
DROP TRIGGER IF EXISTS update_sentry_issue_analyses_updated_at ON sentry_issue_analyses;

-- 테이블 삭제 (의존성 순서 고려)
DROP TABLE IF EXISTS alert_conditions CASCADE;
DROP TABLE IF EXISTS alert_rules CASCADE;
DROP TABLE IF EXISTS monitor_history CASCADE;
DROP TABLE IF EXISTS monitor_sessions CASCADE;
DROP TABLE IF EXISTS report_executions CASCADE;
DROP TABLE IF EXISTS report_settings CASCADE;
DROP TABLE IF EXISTS issue_analyses CASCADE;
DROP TABLE IF EXISTS sentry_issue_analyses CASCADE;
DROP TABLE IF EXISTS notification_logs CASCADE;
DROP TABLE IF EXISTS notification_config CASCADE;

-- 함수 삭제
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
DROP FUNCTION IF EXISTS cleanup_expired_monitors() CASCADE;

-- ============================================
-- 2. Extensions
-- ============================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================
-- 3. 공통 함수 생성
-- ============================================

-- updated_at 자동 업데이트 함수
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 만료된 모니터 자동 정리 함수
CREATE OR REPLACE FUNCTION cleanup_expired_monitors()
RETURNS void AS $$
BEGIN
  UPDATE monitor_sessions
  SET status = 'expired', updated_at = NOW()
  WHERE status = 'active'
    AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 4. 모니터링 관련 테이블
-- ============================================

-- 모니터링 세션 테이블
CREATE TABLE monitor_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  base_release TEXT NOT NULL,
  matched_release TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stopped', 'expired')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  qstash_schedule_id TEXT,
  is_test_mode BOOLEAN NOT NULL DEFAULT FALSE,
  custom_interval_minutes INTEGER,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- 모니터링 히스토리 테이블
CREATE TABLE monitor_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id UUID NOT NULL REFERENCES monitor_sessions(id) ON DELETE CASCADE,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  events_count INTEGER NOT NULL DEFAULT 0,
  issues_count INTEGER NOT NULL DEFAULT 0,
  users_count INTEGER NOT NULL DEFAULT 0,
  top_issues JSONB NOT NULL DEFAULT '[]',
  slack_sent BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 인덱스
CREATE INDEX idx_monitor_sessions_status ON monitor_sessions(status);
CREATE INDEX idx_monitor_sessions_expires_at ON monitor_sessions(expires_at);
CREATE INDEX idx_monitor_sessions_platform ON monitor_sessions(platform);
CREATE INDEX idx_monitor_history_monitor_id ON monitor_history(monitor_id);
CREATE INDEX idx_monitor_history_executed_at ON monitor_history(executed_at);

-- RLS 정책
ALTER TABLE monitor_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitor_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to monitor_sessions" ON monitor_sessions FOR ALL USING (true);
CREATE POLICY "Allow all access to monitor_history" ON monitor_history FOR ALL USING (true);

-- 트리거
CREATE TRIGGER update_monitor_sessions_updated_at
  BEFORE UPDATE ON monitor_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 5. 리포트 관련 테이블 (daily만 지원)
-- ============================================

-- 리포트 실행 기록 테이블
CREATE TABLE report_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type TEXT NOT NULL CHECK (report_type IN ('daily')),
  status TEXT NOT NULL CHECK (status IN ('success', 'error', 'running')),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('scheduled', 'manual')),
  platform TEXT CHECK (platform IN ('android', 'ios')),
  target_date DATE NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  result_data JSONB,
  ai_analysis JSONB,
  slack_sent BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT,
  execution_time_ms INTEGER,
  execution_logs TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 리포트 설정 테이블
CREATE TABLE report_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type TEXT NOT NULL CHECK (report_type IN ('daily')),
  auto_enabled BOOLEAN NOT NULL DEFAULT false,
  schedule_time TIME NOT NULL DEFAULT '09:00',
  schedule_days TEXT[] DEFAULT ARRAY['mon','tue','wed','thu','fri','sat','sun']::TEXT[],
  slack_days TEXT[] DEFAULT ARRAY['tue','wed','thu','fri']::TEXT[],
  ai_enabled BOOLEAN NOT NULL DEFAULT true,
  is_test_mode BOOLEAN NOT NULL DEFAULT false,
  qstash_schedule_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(report_type),
  CONSTRAINT chk_report_settings_schedule_days_valid CHECK (
    schedule_days IS NULL OR schedule_days <@ ARRAY['mon','tue','wed','thu','fri','sat','sun']::TEXT[]
  ),
  CONSTRAINT chk_report_settings_slack_days_valid CHECK (
    slack_days IS NULL OR slack_days <@ ARRAY['mon','tue','wed','thu','fri','sat','sun']::TEXT[]
  )
);

-- 인덱스
CREATE INDEX idx_report_executions_type_date ON report_executions(report_type, target_date DESC);
CREATE INDEX idx_report_executions_status ON report_executions(status);
CREATE INDEX idx_report_executions_created_at ON report_executions(created_at DESC);
CREATE INDEX idx_report_executions_platform ON report_executions(platform);
CREATE INDEX idx_report_settings_type ON report_settings(report_type);

-- RLS 정책
ALTER TABLE report_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to report_executions" ON report_executions FOR ALL USING (true);
CREATE POLICY "Allow all access to report_settings" ON report_settings FOR ALL USING (true);

-- 트리거
CREATE TRIGGER update_report_settings_updated_at
  BEFORE UPDATE ON report_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 기본 리포트 설정 데이터 (daily만)
INSERT INTO report_settings (report_type, auto_enabled, schedule_time, schedule_days, slack_days, ai_enabled, is_test_mode)
VALUES ('daily', true, '09:00', ARRAY['mon','tue','wed','thu','fri','sat','sun']::TEXT[], ARRAY['tue','wed','thu','fri']::TEXT[], true, false);

-- ============================================
-- 6. 이슈 분석 관련 테이블
-- ============================================

-- 이슈별 AI 분석 결과 저장 테이블 (리포트용)
CREATE TABLE issue_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  issue_id TEXT NOT NULL,
  report_type TEXT NOT NULL CHECK (report_type IN ('daily')),
  date_key TEXT NOT NULL,
  analysis JSONB NOT NULL,
  prompt_digest TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(platform, issue_id, report_type, date_key)
);

-- Sentry 이슈 분석 결과 저장 테이블 (독립 분석용)
CREATE TABLE sentry_issue_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id TEXT NOT NULL,
  issue_short_id TEXT,
  sentry_url TEXT,
  issue_title TEXT NOT NULL,
  issue_level TEXT,
  issue_status TEXT,
  event_count INTEGER DEFAULT 0,
  user_count INTEGER DEFAULT 0,
  first_seen TIMESTAMPTZ,
  last_seen TIMESTAMPTZ,
  ai_analysis JSONB NOT NULL,
  analysis_version TEXT DEFAULT 'v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(issue_id)
);

-- 인덱스
CREATE INDEX idx_issue_analyses_platform ON issue_analyses(platform);
CREATE INDEX idx_issue_analyses_date_key ON issue_analyses(date_key);
CREATE INDEX idx_sentry_analyses_issue_id ON sentry_issue_analyses(issue_id);
CREATE INDEX idx_sentry_analyses_short_id ON sentry_issue_analyses(issue_short_id);
CREATE INDEX idx_sentry_analyses_created_at ON sentry_issue_analyses(created_at DESC);

-- RLS 정책
ALTER TABLE issue_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE sentry_issue_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to issue_analyses" ON issue_analyses FOR ALL USING (true);
CREATE POLICY "Allow all access to sentry_issue_analyses" ON sentry_issue_analyses FOR ALL USING (true);

-- 트리거
CREATE TRIGGER update_issue_analyses_updated_at
  BEFORE UPDATE ON issue_analyses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sentry_issue_analyses_updated_at
  BEFORE UPDATE ON sentry_issue_analyses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 7. Alert Rules 관련 테이블
-- ============================================

-- Alert Rules 테이블
CREATE TABLE alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('daily', 'version-monitor')),
  severity TEXT NOT NULL CHECK (severity IN ('warning', 'critical')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  condition_operator TEXT NOT NULL DEFAULT 'OR' CHECK (condition_operator IN ('AND', 'OR')),
  created_by TEXT DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Alert Conditions 테이블
CREATE TABLE alert_conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  operator TEXT NOT NULL CHECK (operator IN ('gte', 'gt', 'lte', 'lt', 'eq')),
  threshold NUMERIC NOT NULL,
  params JSONB DEFAULT '{}'::jsonb,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 인덱스
CREATE INDEX idx_alert_rules_category ON alert_rules(category);
CREATE INDEX idx_alert_rules_enabled ON alert_rules(enabled);
CREATE INDEX idx_alert_conditions_rule_id ON alert_conditions(rule_id);

-- RLS 정책
ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_conditions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to alert_rules" ON alert_rules FOR ALL USING (true);
CREATE POLICY "Allow all access to alert_conditions" ON alert_conditions FOR ALL USING (true);

-- 트리거
CREATE TRIGGER update_alert_rules_updated_at
  BEFORE UPDATE ON alert_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 기본 Alert Rules 데이터
DO $$
DECLARE
  v_critical_rule_id UUID;
  v_warning_rule_id UUID;
BEGIN
  -- Critical 규칙 (version-monitor)
  INSERT INTO alert_rules (name, category, severity, enabled, condition_operator, created_by)
  VALUES ('버전 모니터링 긴급 알림', 'version-monitor', 'critical', true, 'OR', 'system')
  RETURNING id INTO v_critical_rule_id;

  INSERT INTO alert_conditions (rule_id, metric, operator, threshold, position) VALUES
    (v_critical_rule_id, 'total_crashes', 'gte', 100, 1),
    (v_critical_rule_id, 'fatal_issues', 'gte', 5, 2);

  -- Warning 규칙 (version-monitor)
  INSERT INTO alert_rules (name, category, severity, enabled, condition_operator, created_by)
  VALUES ('버전 모니터링 주의 알림', 'version-monitor', 'warning', true, 'OR', 'system')
  RETURNING id INTO v_warning_rule_id;

  INSERT INTO alert_conditions (rule_id, metric, operator, threshold, position) VALUES
    (v_warning_rule_id, 'total_crashes', 'gte', 50, 1),
    (v_warning_rule_id, 'fatal_issues', 'gte', 3, 2),
    (v_warning_rule_id, 'unique_issues', 'gte', 10, 3);
END $$;

-- ============================================
-- 8. 완료 메시지
-- ============================================
-- 데이터베이스 리셋 완료!
-- 생성된 테이블:
--   - monitor_sessions: 버전별 모니터링 세션
--   - monitor_history: 모니터링 실행 히스토리
--   - report_executions: 리포트 실행 기록
--   - report_settings: 리포트 설정 (daily만)
--   - issue_analyses: 리포트용 이슈 분석
--   - sentry_issue_analyses: 독립 이슈 분석
--   - alert_rules: 알림 규칙
--   - alert_conditions: 알림 조건
