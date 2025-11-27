  -- Migration: Complete schema setup - creates tables and adds missing columns
  -- Run this in your Supabase SQL Editor: https://app.supabase.com/project/_/sql
  -- This migration is idempotent - safe to run multiple times

  -- ==================== CANDIDATES TABLE ====================
  CREATE TABLE IF NOT EXISTS candidates (
    email TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    summary TEXT,
    skills TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  -- Add index for faster lookups
  CREATE INDEX IF NOT EXISTS idx_candidates_email ON candidates(email);

  -- ==================== STARTUPS TABLE ====================
  -- Create table with basic columns first (if it doesn't exist)
  CREATE TABLE IF NOT EXISTS startups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    industry TEXT,
    description TEXT,
    funding_stage TEXT,
    funding_amount TEXT,
    location TEXT,
    website TEXT,
    tags TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  );

  -- Add missing columns to existing startups table if they don't exist
  DO $$ 
  BEGIN
    -- Add founder_first_name
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'startups' AND column_name = 'founder_first_name'
    ) THEN
      ALTER TABLE startups ADD COLUMN founder_first_name TEXT;
    END IF;

    -- Add founder_last_name
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'startups' AND column_name = 'founder_last_name'
    ) THEN
      ALTER TABLE startups ADD COLUMN founder_last_name TEXT;
    END IF;

    -- Add founder_emails
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'startups' AND column_name = 'founder_emails'
    ) THEN
      ALTER TABLE startups ADD COLUMN founder_emails TEXT;
    END IF;

    -- Add founder_linkedin
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'startups' AND column_name = 'founder_linkedin'
    ) THEN
      ALTER TABLE startups ADD COLUMN founder_linkedin TEXT;
    END IF;

    -- Add batch
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'startups' AND column_name = 'batch'
    ) THEN
      ALTER TABLE startups ADD COLUMN batch TEXT;
    END IF;

    -- Add job_openings
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'startups' AND column_name = 'job_openings'
    ) THEN
      ALTER TABLE startups ADD COLUMN job_openings TEXT;
    END IF;

    -- Add date_raised
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'startups' AND column_name = 'date_raised'
    ) THEN
      ALTER TABLE startups ADD COLUMN date_raised TEXT;
    END IF;

    -- Ensure created_at exists (in case table was created without it)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'startups' AND column_name = 'created_at'
    ) THEN
      ALTER TABLE startups ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    END IF;
  END $$;

  -- Add indexes for startups table
  CREATE INDEX IF NOT EXISTS idx_startups_id ON startups(id);
  CREATE INDEX IF NOT EXISTS idx_startups_name ON startups(name);

  -- Add index for founder_emails if column exists and index doesn't
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'startups' AND column_name = 'founder_emails'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_indexes 
      WHERE tablename = 'startups' AND indexname = 'idx_startups_founder_emails'
    ) THEN
      CREATE INDEX idx_startups_founder_emails ON startups(founder_emails);
    END IF;
  END $$;

  -- ==================== MATCHES TABLE ====================
  CREATE TABLE IF NOT EXISTS matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_email TEXT NOT NULL REFERENCES candidates(email) ON DELETE CASCADE,
    startup_id TEXT NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
    score FLOAT NOT NULL CHECK (score >= 0 AND score <= 1),
    matched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(candidate_email, startup_id) -- Prevent duplicate matches
  );

  -- Add indexes for matches table
  CREATE INDEX IF NOT EXISTS idx_matches_candidate_email ON matches(candidate_email);
  CREATE INDEX IF NOT EXISTS idx_matches_startup_id ON matches(startup_id);
  CREATE INDEX IF NOT EXISTS idx_matches_score ON matches(score DESC);

  -- ==================== ROW LEVEL SECURITY (RLS) ====================
  -- Enable RLS on all tables (idempotent - won't error if already enabled)
  DO $$
  BEGIN
    ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
  EXCEPTION
    WHEN OTHERS THEN NULL; -- Ignore if already enabled
  END $$;

  DO $$
  BEGIN
    ALTER TABLE startups ENABLE ROW LEVEL SECURITY;
  EXCEPTION
    WHEN OTHERS THEN NULL; -- Ignore if already enabled
  END $$;

  DO $$
  BEGIN
    ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
  EXCEPTION
    WHEN OTHERS THEN NULL; -- Ignore if already enabled
  END $$;

  -- Policy: Allow service role to do everything (for server-side operations)
  -- Drop and recreate to avoid conflicts if policies already exist
  DROP POLICY IF EXISTS "Service role can manage candidates" ON candidates;
  CREATE POLICY "Service role can manage candidates"
    ON candidates FOR ALL
    USING (auth.role() = 'service_role');

  DROP POLICY IF EXISTS "Service role can manage startups" ON startups;
  CREATE POLICY "Service role can manage startups"
    ON startups FOR ALL
    USING (auth.role() = 'service_role');

  DROP POLICY IF EXISTS "Service role can manage matches" ON matches;
  CREATE POLICY "Service role can manage matches"
    ON matches FOR ALL
    USING (auth.role() = 'service_role');

  -- Policy: Allow authenticated users to read their own data
  DROP POLICY IF EXISTS "Users can read their own candidate data" ON candidates;
  CREATE POLICY "Users can read their own candidate data"
    ON candidates FOR SELECT
    USING (auth.uid()::text = email OR auth.role() = 'service_role');

  DROP POLICY IF EXISTS "Users can read all startups" ON startups;
  CREATE POLICY "Users can read all startups"
    ON startups FOR SELECT
    USING (true);

  DROP POLICY IF EXISTS "Users can read their own matches" ON matches;
  CREATE POLICY "Users can read their own matches"
    ON matches FOR SELECT
    USING (auth.uid()::text = candidate_email OR auth.role() = 'service_role');

  -- Note: If you're using the service role key (SUPABASE_SERVICE_ROLE_KEY),
  -- these RLS policies won't apply since service role bypasses RLS.
  -- If you want public read access, you can modify or remove the RLS policies.

