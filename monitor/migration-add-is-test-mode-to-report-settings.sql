-- report_settings 테이블에 테스트 모드 컬럼 추가
-- Supabase SQL Editor 또는 psql에서 실행하세요

ALTER TABLE report_settings 
ADD COLUMN IF NOT EXISTS is_test_mode BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN report_settings.is_test_mode IS '테스트 모드 여부 (테스트 채널로 전송)';

-- 기본값 확인
SELECT report_type, auto_enabled, schedule_time, schedule_days, ai_enabled, is_test_mode
FROM report_settings
ORDER BY report_type;

