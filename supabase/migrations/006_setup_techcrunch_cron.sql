-- ============================================================
-- TechCrunch Scraper Cron Job Setup for Supabase
-- ============================================================
-- This migration sets up pg_cron to call the TechCrunch scraper API
-- every hour during TechCrunch's active hours (6 AM - 10 PM Pacific)
-- ============================================================

-- Step 1: Enable pg_cron extension (if not already enabled)
-- Note: This may require enabling in Supabase Dashboard first:
-- Dashboard → Database → Extensions → Search "pg_cron" → Enable
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- Grant necessary permissions
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

-- Step 2: Enable pg_net extension (for making HTTP requests)
-- Note: Enable in Dashboard → Database → Extensions → Search "pg_net" → Enable
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Step 3: Store API URL and secret in Supabase Vault (recommended for security)
-- Replace these with your actual values:
-- 1. Your deployed Next.js app URL (e.g., https://your-app.vercel.app)
-- 2. Your CRON_SECRET (optional, for API authentication)
--
-- To set these, run in SQL Editor:
-- SELECT vault.create_secret('https://your-app.vercel.app/api/scrape-techcrunch', 'techcrunch_api_url');
-- SELECT vault.create_secret('your-cron-secret-here', 'techcrunch_cron_secret');
--
-- Or set them as database settings (less secure):
-- ALTER DATABASE postgres SET app.techcrunch_api_url = 'https://your-app.vercel.app/api/scrape-techcrunch';
-- ALTER DATABASE postgres SET app.cron_secret = 'your-secret-here';

-- Step 4: Create function to call the TechCrunch scraper API
CREATE OR REPLACE FUNCTION call_techcrunch_scraper()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  api_url TEXT;
  cron_secret TEXT;
  request_id BIGINT;
BEGIN
  -- Try to get API URL from Vault first, then from database settings
  BEGIN
    SELECT decrypted_secret INTO api_url
    FROM vault.decrypted_secrets
    WHERE name = 'techcrunch_api_url'
    LIMIT 1;
  EXCEPTION
    WHEN OTHERS THEN
      -- Vault not available or secret not set, try database setting
      api_url := current_setting('app.techcrunch_api_url', true);
  END;
  
  -- Try to get cron secret from Vault first, then from database settings
  BEGIN
    SELECT decrypted_secret INTO cron_secret
    FROM vault.decrypted_secrets
    WHERE name = 'techcrunch_cron_secret'
    LIMIT 1;
  EXCEPTION
    WHEN OTHERS THEN
      -- Vault not available or secret not set, try database setting
      cron_secret := current_setting('app.cron_secret', true);
  END;
  
  -- Fallback to default if not set
  IF api_url IS NULL OR api_url = '' THEN
    RAISE WARNING 'techcrunch_api_url not set. Please set it in Vault or database settings.';
    RETURN;
  END IF;
  
  -- Make HTTP POST request to the API endpoint
  SELECT net.http_post(
    url := api_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(cron_secret, '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000 -- 5 minutes timeout
  ) INTO request_id;
  
  RAISE NOTICE 'TechCrunch scraper API called at %. Request ID: %', now(), request_id;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Failed to call TechCrunch scraper API: %', SQLERRM;
END;
$$;

-- Step 5: Schedule the cron job
-- Runs every hour from 13:00 to 22:00 UTC (approximately 6 AM - 10 PM Pacific)
-- Note: This is approximate - adjust for daylight saving time changes
SELECT cron.schedule(
  'techcrunch-scraper-hourly',
  '0 13-22 * * *', -- Every hour from 13:00 to 22:00 UTC
  $$
  SELECT call_techcrunch_scraper();
  $$
);

-- ============================================================
-- USAGE INSTRUCTIONS:
-- ============================================================
-- 1. Enable extensions in Supabase Dashboard:
--    - Go to Database → Extensions
--    - Enable "pg_cron"
--    - Enable "pg_net"
--
-- 2. Set your API URL and secret (choose one method):
--
--    Method A: Using Supabase Vault (Recommended - More Secure):
--    SELECT vault.create_secret('https://your-app.vercel.app/api/scrape-techcrunch', 'techcrunch_api_url');
--    SELECT vault.create_secret('your-secret-key', 'techcrunch_cron_secret');
--
--    Method B: Using Database Settings (Less Secure):
--    ALTER DATABASE postgres SET app.techcrunch_api_url = 'https://your-app.vercel.app/api/scrape-techcrunch';
--    ALTER DATABASE postgres SET app.cron_secret = 'your-secret-key';
--
-- 3. Verify the cron job is scheduled:
--    SELECT * FROM cron.job WHERE jobname = 'techcrunch-scraper-hourly';
--
-- 4. Check cron job execution history:
--    SELECT * FROM cron.job_run_details 
--    WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'techcrunch-scraper-hourly')
--    ORDER BY start_time DESC
--    LIMIT 10;
--
-- 5. To unschedule the job:
--    SELECT cron.unschedule('techcrunch-scraper-hourly');
--
-- 6. To update the schedule:
--    SELECT cron.unschedule('techcrunch-scraper-hourly');
--    SELECT cron.schedule('techcrunch-scraper-hourly', '0 13-22 * * *', $$SELECT call_techcrunch_scraper();$$);
-- ============================================================
