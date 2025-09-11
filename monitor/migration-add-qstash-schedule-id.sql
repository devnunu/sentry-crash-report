-- QStash 스케줄 ID를 저장할 컬럼 추가
ALTER TABLE report_settings 
ADD COLUMN IF NOT EXISTS qstash_schedule_id VARCHAR(255);

-- 기존 데이터에 대한 인덱스 생성 (선택사항)
CREATE INDEX IF NOT EXISTS idx_report_settings_qstash_schedule_id 
ON report_settings (qstash_schedule_id);

-- 코멘트 추가
COMMENT ON COLUMN report_settings.qstash_schedule_id 
IS 'QStash에서 반환된 스케줄 ID, 스케줄 관리를 위해 사용';