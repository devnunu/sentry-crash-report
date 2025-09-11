-- 이슈별 AI 분석 캐시 테이블
CREATE TABLE IF NOT EXISTS issue_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL CHECK (platform IN ('android','ios')),
  issue_id TEXT NOT NULL,
  report_type TEXT NOT NULL CHECK (report_type IN ('daily','weekly')),
  date_key TEXT NOT NULL, -- daily: YYYY-MM-DD, weekly: YYYY-MM-DD~YYYY-MM-DD
  analysis JSONB NOT NULL,
  prompt_digest TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(platform, issue_id, report_type, date_key)
);

CREATE INDEX IF NOT EXISTS idx_issue_analyses_issue ON issue_analyses(issue_id);
CREATE INDEX IF NOT EXISTS idx_issue_analyses_platform ON issue_analyses(platform);

ALTER TABLE issue_analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to issue_analyses" ON issue_analyses FOR ALL USING (true);

