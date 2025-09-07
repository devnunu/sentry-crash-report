-- 기존 report_executions 테이블에 execution_logs 컬럼 추가
-- Supabase SQL Editor에서 실행하세요

ALTER TABLE report_executions 
ADD COLUMN IF NOT EXISTS execution_logs TEXT[];

-- 인덱스 추가 (선택사항)
CREATE INDEX IF NOT EXISTS idx_report_executions_logs 
ON report_executions USING gin(execution_logs);

COMMENT ON COLUMN report_executions.execution_logs IS '리포트 실행 과정의 상세 로그들을 저장하는 배열';