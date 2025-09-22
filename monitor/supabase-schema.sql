-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 모니터링 세션 테이블
CREATE TABLE IF NOT EXISTS monitor_sessions (
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
  is_test_mode BOOLEAN NOT NULL DEFAULT FALSE
);

-- 모니터링 히스토리 테이블 (각 tick 실행 결과 저장)
CREATE TABLE IF NOT EXISTS monitor_history (
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

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_monitor_sessions_status ON monitor_sessions(status);
CREATE INDEX IF NOT EXISTS idx_monitor_sessions_expires_at ON monitor_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_monitor_sessions_platform ON monitor_sessions(platform);
CREATE INDEX IF NOT EXISTS idx_monitor_history_monitor_id ON monitor_history(monitor_id);
CREATE INDEX IF NOT EXISTS idx_monitor_history_executed_at ON monitor_history(executed_at);

-- RLS (Row Level Security) 정책 활성화
ALTER TABLE monitor_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitor_history ENABLE ROW LEVEL SECURITY;

-- 모든 사용자가 읽기/쓰기 가능한 정책 (향후 인증이 필요하면 수정)
CREATE POLICY "Allow all access to monitor_sessions" ON monitor_sessions
  FOR ALL USING (true);

CREATE POLICY "Allow all access to monitor_history" ON monitor_history
  FOR ALL USING (true);

-- updated_at 자동 업데이트를 위한 함수
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- updated_at 트리거 생성
CREATE TRIGGER update_monitor_sessions_updated_at 
  BEFORE UPDATE ON monitor_sessions 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 만료된 모니터 자동 정리를 위한 함수
CREATE OR REPLACE FUNCTION cleanup_expired_monitors()
RETURNS void AS $$
BEGIN
  UPDATE monitor_sessions 
  SET status = 'expired', updated_at = NOW()
  WHERE status = 'active' 
    AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- 리포트 실행 기록 테이블
CREATE TABLE IF NOT EXISTS report_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type TEXT NOT NULL CHECK (report_type IN ('daily', 'weekly')),
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
  execution_logs TEXT[], -- 실행 로그들을 배열로 저장
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 리포트 설정 테이블
CREATE TABLE IF NOT EXISTS report_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type TEXT NOT NULL CHECK (report_type IN ('daily', 'weekly')),
  auto_enabled BOOLEAN NOT NULL DEFAULT false,
  schedule_time TIME NOT NULL DEFAULT '09:00',
  schedule_days TEXT[] DEFAULT ARRAY[]::TEXT[],
  slack_days TEXT[] DEFAULT NULL,
  ai_enabled BOOLEAN NOT NULL DEFAULT true,
  is_test_mode BOOLEAN NOT NULL DEFAULT false,
  qstash_schedule_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(report_type)
);

-- 리포트 테이블 인덱스
CREATE INDEX IF NOT EXISTS idx_report_executions_type_date ON report_executions(report_type, target_date DESC);
CREATE INDEX IF NOT EXISTS idx_report_executions_status ON report_executions(status);
CREATE INDEX IF NOT EXISTS idx_report_executions_created_at ON report_executions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_executions_platform ON report_executions(platform);
CREATE INDEX IF NOT EXISTS idx_report_settings_type ON report_settings(report_type);

-- schedule_days 값 검증(허용 요일만)
-- 주의: Postgres는 ADD CONSTRAINT에 IF NOT EXISTS를 지원하지 않습니다.
-- 아래 DO 블록에서 존재 여부를 확인한 뒤 제약조건을 추가합니다.

-- RLS 정책 활성화
ALTER TABLE report_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_settings ENABLE ROW LEVEL SECURITY;

-- 모든 사용자가 읽기/쓰기 가능한 정책
CREATE POLICY "Allow all access to report_executions" ON report_executions
  FOR ALL USING (true);

CREATE POLICY "Allow all access to report_settings" ON report_settings
  FOR ALL USING (true);

-- report_settings updated_at 트리거
CREATE TRIGGER update_report_settings_updated_at 
  BEFORE UPDATE ON report_settings 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 기본 리포트 설정 데이터 삽입 (요일 기본값 포함)
INSERT INTO report_settings (report_type, auto_enabled, schedule_time, schedule_days, slack_days, ai_enabled, is_test_mode) 
VALUES 
  ('daily', true, '09:00', ARRAY['mon','tue','wed','thu','fri','sat','sun']::TEXT[], ARRAY['tue','wed','thu','fri']::TEXT[], true, false),
  ('weekly', true, '09:00', ARRAY['mon']::TEXT[], ARRAY['mon']::TEXT[], true, false)
ON CONFLICT (report_type) DO NOTHING;

-- 이슈별 AI 분석 결과 저장 테이블
CREATE TABLE IF NOT EXISTS issue_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  issue_id TEXT NOT NULL,
  report_type TEXT NOT NULL CHECK (report_type IN ('daily', 'weekly')),
  date_key TEXT NOT NULL, -- 'YYYY-MM-DD' (daily) 또는 주차 기준 키
  analysis JSONB NOT NULL,
  prompt_digest TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(platform, issue_id, report_type, date_key)
);

-- 인덱스 (issue_analyses)
CREATE INDEX IF NOT EXISTS idx_issue_analyses_platform ON issue_analyses(platform);
CREATE INDEX IF NOT EXISTS idx_issue_analyses_date_key ON issue_analyses(date_key);

-- RLS 정책 활성화 (issue_analyses)
ALTER TABLE issue_analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to issue_analyses" ON issue_analyses FOR ALL USING (true);

-- issue_analyses updated_at 트리거
CREATE TRIGGER update_issue_analyses_updated_at 
  BEFORE UPDATE ON issue_analyses 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 스키마 보완용 컬럼 추가(기존 테이블에 누락 시)
ALTER TABLE monitor_sessions 
  ADD COLUMN IF NOT EXISTS qstash_schedule_id TEXT,
  ADD COLUMN IF NOT EXISTS is_test_mode BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE report_executions 
  ADD COLUMN IF NOT EXISTS platform TEXT CHECK (platform IN ('android','ios'));

ALTER TABLE report_settings 
  ADD COLUMN IF NOT EXISTS schedule_days TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS slack_days TEXT[] DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_test_mode BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS qstash_schedule_id TEXT;

-- schedule_days와 slack_days 제약조건 재보장(존재하지 않을 경우만)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'chk_report_settings_schedule_days_valid'
  ) THEN
    ALTER TABLE report_settings
      ADD CONSTRAINT chk_report_settings_schedule_days_valid
      CHECK (
        schedule_days IS NULL
        OR schedule_days <@ ARRAY['mon','tue','wed','thu','fri','sat','sun']::TEXT[]
      );
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'chk_report_settings_slack_days_valid'
  ) THEN
    ALTER TABLE report_settings
      ADD CONSTRAINT chk_report_settings_slack_days_valid
      CHECK (
        slack_days IS NULL
        OR slack_days <@ ARRAY['mon','tue','wed','thu','fri','sat','sun']::TEXT[]
      );
  END IF;
END $$;

-- 기존 데이터에 slack_days 기본값 설정
UPDATE report_settings 
SET slack_days = ARRAY['tue', 'wed', 'thu', 'fri'] 
WHERE report_type = 'daily' AND slack_days IS NULL;

UPDATE report_settings 
SET slack_days = ARRAY['mon'] 
WHERE report_type = 'weekly' AND slack_days IS NULL;

-- Sentry 이슈 분석 결과 저장 테이블
CREATE TABLE IF NOT EXISTS sentry_issue_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id TEXT NOT NULL, -- 정규화된 이슈 ID (숫자만)
  issue_short_id TEXT, -- FINDA-IOS-ABC 형태
  sentry_url TEXT, -- 원본 Sentry URL
  issue_title TEXT NOT NULL,
  issue_level TEXT, -- WARNING, ERROR, FATAL 등
  issue_status TEXT, -- resolved, unresolved
  event_count INTEGER DEFAULT 0,
  user_count INTEGER DEFAULT 0,
  first_seen TIMESTAMPTZ,
  last_seen TIMESTAMPTZ,
  ai_analysis JSONB NOT NULL, -- AI 분석 결과 전체
  analysis_version TEXT DEFAULT 'v1', -- 분석 버전 (추후 재분석 필요 여부 판단)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(issue_id)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_sentry_analyses_issue_id ON sentry_issue_analyses(issue_id);
CREATE INDEX IF NOT EXISTS idx_sentry_analyses_short_id ON sentry_issue_analyses(issue_short_id);
CREATE INDEX IF NOT EXISTS idx_sentry_analyses_created_at ON sentry_issue_analyses(created_at DESC);

-- RLS 정책
ALTER TABLE sentry_issue_analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to sentry_issue_analyses" ON sentry_issue_analyses FOR ALL USING (true);

-- updated_at 트리거
CREATE TRIGGER update_sentry_issue_analyses_updated_at 
  BEFORE UPDATE ON sentry_issue_analyses 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
