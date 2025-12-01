-- Migration: Update enrichment fields
-- Replace tech_stack with required_skills
-- Add funding_date field
-- Created: 2025-11-30

-- Add new required_skills column (replaces tech_stack concept)
ALTER TABLE startups
ADD COLUMN IF NOT EXISTS required_skills TEXT;

COMMENT ON COLUMN startups.required_skills IS 'Technical skills/technologies required in job postings (extracted from career pages)';

-- Add funding_date column
ALTER TABLE startups
ADD COLUMN IF NOT EXISTS funding_date TEXT;

COMMENT ON COLUMN startups.funding_date IS 'Date of funding announcement (YYYY-MM-DD, YYYY-MM, or YYYY format)';

-- Optional: If you want to migrate existing tech_stack data to required_skills
-- Uncomment if tech_stack column exists and has data:
-- UPDATE startups
-- SET required_skills = tech_stack
-- WHERE tech_stack IS NOT NULL AND tech_stack != '' AND required_skills IS NULL;

-- Optional: Drop old tech_stack column if it exists
-- Uncomment to remove the old column:
-- ALTER TABLE startups DROP COLUMN IF EXISTS tech_stack;
