-- monitor_sessions 테이블에 QStash 스케줄 ID 컬럼 추가
ALTER TABLE monitor_sessions 
ADD COLUMN IF NOT EXISTS qstash_schedule_id VARCHAR(255);

-- 인덱스 생성 (선택사항)
CREATE INDEX IF NOT EXISTS idx_monitor_sessions_qstash_schedule_id 
ON monitor_sessions (qstash_schedule_id);

-- 코멘트 추가
COMMENT ON COLUMN monitor_sessions.qstash_schedule_id 
IS 'QStash에서 반환된 monitor tick 스케줄 ID';