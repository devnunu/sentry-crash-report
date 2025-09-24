-- Enhanced Sentry issue analysis table (upgrade existing table)
-- This should be run in your Supabase SQL editor

-- Add new columns to existing table if they don't exist
DO $$
BEGIN
    -- Add analysis_version column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sentry_issue_analyses' AND column_name = 'analysis_version') THEN
        ALTER TABLE sentry_issue_analyses ADD COLUMN analysis_version TEXT DEFAULT 'v1';
    END IF;
    
    -- Add is_monitored column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sentry_issue_analyses' AND column_name = 'is_monitored') THEN
        ALTER TABLE sentry_issue_analyses ADD COLUMN is_monitored BOOLEAN DEFAULT false;
    END IF;
    
    -- Add auto_analyzed column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sentry_issue_analyses' AND column_name = 'auto_analyzed') THEN
        ALTER TABLE sentry_issue_analyses ADD COLUMN auto_analyzed BOOLEAN DEFAULT false;
    END IF;
END
$$;

-- Create monitoring_config table
CREATE TABLE IF NOT EXISTS monitoring_config (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    enabled BOOLEAN DEFAULT true,
    project_slugs TEXT[] DEFAULT ARRAY['finda-ios'],
    min_level TEXT DEFAULT 'error',
    auto_analyze BOOLEAN DEFAULT true,
    max_issues_per_check INTEGER DEFAULT 5,
    check_interval_minutes INTEGER DEFAULT 5,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default config if not exists
INSERT INTO monitoring_config (enabled, project_slugs, min_level, auto_analyze, max_issues_per_check, check_interval_minutes)
SELECT true, ARRAY['finda-ios'], 'error', true, 5, 5
WHERE NOT EXISTS (SELECT 1 FROM monitoring_config);

-- Create monitoring_logs table
CREATE TABLE IF NOT EXISTS monitoring_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    check_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    issues_found INTEGER DEFAULT 0,
    issues_analyzed INTEGER DEFAULT 0,
    results JSONB DEFAULT '[]',
    status TEXT DEFAULT 'pending',
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create webhook_logs table  
CREATE TABLE IF NOT EXISTS webhook_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    webhook_type TEXT DEFAULT 'sentry',
    action TEXT,
    issue_id TEXT,
    issue_short_id TEXT,
    issue_title TEXT,
    project_slug TEXT,
    success BOOLEAN DEFAULT false,
    error_message TEXT,
    payload JSONB,
    received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_sentry_issue_analyses_is_monitored ON sentry_issue_analyses(is_monitored);
CREATE INDEX IF NOT EXISTS idx_sentry_issue_analyses_analysis_version ON sentry_issue_analyses(analysis_version);
CREATE INDEX IF NOT EXISTS idx_sentry_issue_analyses_auto_analyzed ON sentry_issue_analyses(auto_analyzed);
CREATE INDEX IF NOT EXISTS idx_monitoring_logs_check_time ON monitoring_logs(check_time DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_received_at ON webhook_logs(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_webhook_type_success ON webhook_logs(webhook_type, success);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_issue_id ON webhook_logs(issue_id);

-- Update existing analyses to mark them as v1
UPDATE sentry_issue_analyses 
SET analysis_version = 'v1' 
WHERE analysis_version IS NULL;

-- Add comments for documentation
COMMENT ON TABLE monitoring_config IS 'Configuration settings for automated Sentry monitoring';
COMMENT ON TABLE monitoring_logs IS 'Logs of automated monitoring checks and results';  
COMMENT ON TABLE webhook_logs IS 'Logs of incoming webhooks from Sentry';

COMMENT ON COLUMN sentry_issue_analyses.analysis_version IS 'Version of AI analysis used (v1, v2_enhanced, v2_enhanced_webhook)';
COMMENT ON COLUMN sentry_issue_analyses.is_monitored IS 'Whether this issue was found through automated monitoring';
COMMENT ON COLUMN sentry_issue_analyses.auto_analyzed IS 'Whether this issue was analyzed automatically via webhook/monitoring';

-- Create a view for monitoring statistics
CREATE OR REPLACE VIEW monitoring_statistics AS
SELECT 
    COUNT(*) AS total_analyses,
    COUNT(*) FILTER (WHERE analysis_version LIKE 'v2%') AS enhanced_analyses,
    COUNT(*) FILTER (WHERE is_monitored = true) AS monitored_analyses,
    COUNT(*) FILTER (WHERE auto_analyzed = true) AS auto_analyses,
    COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS last_24h_analyses,
    COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS last_7d_analyses,
    MAX(updated_at) AS last_analysis_time
FROM sentry_issue_analyses;

-- Create a view for webhook statistics
CREATE OR REPLACE VIEW webhook_statistics AS  
SELECT
    COUNT(*) AS total_webhooks,
    COUNT(*) FILTER (WHERE success = true) AS successful_webhooks,
    COUNT(*) FILTER (WHERE success = false) AS failed_webhooks,
    COUNT(*) FILTER (WHERE received_at >= NOW() - INTERVAL '24 hours') AS last_24h_webhooks,
    COUNT(*) FILTER (WHERE received_at >= NOW() - INTERVAL '7 days') AS last_7d_webhooks,
    MAX(received_at) AS last_webhook_time,
    COUNT(DISTINCT action) AS unique_actions
FROM webhook_logs;

-- Grant permissions (adjust as needed for your setup)
-- These might need to be run separately depending on your Supabase setup
-- GRANT SELECT, INSERT, UPDATE ON monitoring_config TO authenticated;
-- GRANT SELECT, INSERT ON monitoring_logs TO authenticated;  
-- GRANT SELECT, INSERT ON webhook_logs TO authenticated;
-- GRANT SELECT ON monitoring_statistics TO authenticated;
-- GRANT SELECT ON webhook_statistics TO authenticated;

-- Enable Row Level Security if needed (uncomment if you want RLS)
-- ALTER TABLE monitoring_config ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE monitoring_logs ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;

-- Create RLS policies if needed (uncomment and modify as needed)
-- CREATE POLICY "Allow authenticated users to read monitoring_config" ON monitoring_config FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "Allow authenticated users to read monitoring_logs" ON monitoring_logs FOR SELECT TO authenticated USING (true);
-- CREATE POLICY "Allow authenticated users to read webhook_logs" ON webhook_logs FOR SELECT TO authenticated USING (true);