-- Create empty startups table with all required columns
-- Run this in your Supabase SQL Editor: https://app.supabase.com/project/_/sql

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
  founder_first_name TEXT,
  founder_last_name TEXT,
  founder_emails TEXT,
  founder_linkedin TEXT,
  batch TEXT,
  job_openings TEXT,
  date_raised TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_startups_id ON startups(id);
CREATE INDEX IF NOT EXISTS idx_startups_name ON startups(name);
CREATE INDEX IF NOT EXISTS idx_startups_founder_emails ON startups(founder_emails);

