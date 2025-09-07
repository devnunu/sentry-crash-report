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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  ai_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(report_type)
);

-- 리포트 테이블 인덱스
CREATE INDEX IF NOT EXISTS idx_report_executions_type_date ON report_executions(report_type, target_date DESC);
CREATE INDEX IF NOT EXISTS idx_report_executions_status ON report_executions(status);
CREATE INDEX IF NOT EXISTS idx_report_executions_created_at ON report_executions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_settings_type ON report_settings(report_type);

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

-- 기본 리포트 설정 데이터 삽입
INSERT INTO report_settings (report_type, auto_enabled, schedule_time, ai_enabled) 
VALUES 
  ('daily', true, '09:00', true),
  ('weekly', true, '09:00', true)
ON CONFLICT (report_type) DO NOTHING;