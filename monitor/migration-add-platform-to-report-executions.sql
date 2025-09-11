-- report_executions에 플랫폼 컬럼 추가
-- Supabase SQL Editor에서 실행하세요

ALTER TABLE report_executions 
ADD COLUMN IF NOT EXISTS platform TEXT CHECK (platform IN ('android','ios'));

-- 조회 최적화 인덱스 (선택)
CREATE INDEX IF NOT EXISTS idx_report_executions_platform 
  ON report_executions(platform);

COMMENT ON COLUMN report_executions.platform IS '리포트가 실행된 플랫폼 (android/ios)';

