-- 리포트 설정 테이블에 요일 설정 컬럼 추가
-- 실행: psql -d your_db < migration-add-schedule-days.sql

-- 1. 요일 설정 컬럼 추가 (JSON 배열로 저장)
ALTER TABLE report_settings 
ADD COLUMN IF NOT EXISTS schedule_days JSONB NOT NULL DEFAULT '["mon","tue","wed","thu","fri"]';

-- 2. 기존 데이터 업데이트
-- 일간 리포트: 월화수목금 (기본값)
-- 주간 리포트: 월요일만
UPDATE report_settings 
SET schedule_days = '["mon","tue","wed","thu","fri"]'::jsonb 
WHERE report_type = 'daily';

UPDATE report_settings 
SET schedule_days = '["mon"]'::jsonb 
WHERE report_type = 'weekly';

-- 3. 인덱스 추가 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_report_settings_schedule_days 
ON report_settings USING gin (schedule_days);

-- 4. 스키마 변경 완료 확인
SELECT report_type, auto_enabled, schedule_time, schedule_days, ai_enabled
FROM report_settings 
ORDER BY report_type;