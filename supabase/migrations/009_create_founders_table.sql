-- Phase 2: Create Founders Table
--
-- This migration creates a separate founders table to properly store multiple founders
-- per startup, with proper relational structure for better querying and matching.
--
-- Benefits:
-- 1. Multiple founders per startup (one-to-many relationship)
-- 2. Individual email verification status per founder
-- 3. Query by university, background, role, etc.
-- 4. Better data integrity and normalization
--
-- Migration Strategy:
-- 1. Create new founders table
-- 2. Keep old CSV columns for backward compatibility
-- 3. Migrate existing data using migration script
-- 4. Gradually update code to use new table

-- Create founders table
CREATE TABLE IF NOT EXISTS founders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    startup_id UUID NOT NULL REFERENCES startups(id) ON DELETE CASCADE,

    -- Basic info
    name TEXT NOT NULL,
    email TEXT,
    role TEXT, -- CEO, CTO, Co-founder, etc.

    -- Contact & social
    linkedin_url TEXT,
    twitter_url TEXT,
    personal_website TEXT,

    -- Background (for matching)
    university TEXT,
    degree TEXT,
    graduation_year INTEGER,
    previous_company TEXT,
    previous_role TEXT,
    background TEXT, -- Free-form description

    -- Email discovery metadata
    email_source TEXT, -- 'pattern_matched', 'hunter.io', 'manual', 'techcrunch', etc.
    email_verified BOOLEAN DEFAULT false,
    email_verification_date TIMESTAMPTZ,
    email_confidence DECIMAL(3, 2), -- 0.00 - 1.00
    needs_manual_review BOOLEAN DEFAULT false,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    CONSTRAINT founders_email_format CHECK (email IS NULL OR email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$'),
    CONSTRAINT founders_confidence_range CHECK (email_confidence IS NULL OR (email_confidence >= 0 AND email_confidence <= 1))
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_founders_startup_id ON founders(startup_id);
CREATE INDEX IF NOT EXISTS idx_founders_email ON founders(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_founders_university ON founders(university) WHERE university IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_founders_previous_company ON founders(previous_company) WHERE previous_company IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_founders_needs_review ON founders(needs_manual_review) WHERE needs_manual_review = true;
CREATE INDEX IF NOT EXISTS idx_founders_email_verified ON founders(email_verified);
CREATE INDEX IF NOT EXISTS idx_founders_created_at ON founders(created_at DESC);

-- Create composite index for matching queries (university + company)
CREATE INDEX IF NOT EXISTS idx_founders_matching ON founders(university, previous_company)
    WHERE university IS NOT NULL AND previous_company IS NOT NULL;

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_founders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER founders_updated_at_trigger
    BEFORE UPDATE ON founders
    FOR EACH ROW
    EXECUTE FUNCTION update_founders_updated_at();

-- Add comments
COMMENT ON TABLE founders IS 'Individual founders for each startup, with email discovery metadata';
COMMENT ON COLUMN founders.startup_id IS 'Reference to the startup this founder belongs to';
COMMENT ON COLUMN founders.name IS 'Full name of the founder';
COMMENT ON COLUMN founders.email IS 'Founder email address (verified or unverified)';
COMMENT ON COLUMN founders.role IS 'Founder role: CEO, CTO, Co-founder, etc.';
COMMENT ON COLUMN founders.email_source IS 'How the email was discovered: pattern_matched, hunter.io, manual, techcrunch, etc.';
COMMENT ON COLUMN founders.email_verified IS 'Whether the email has been verified as deliverable';
COMMENT ON COLUMN founders.email_confidence IS 'Confidence score from email verification (0.0 - 1.0)';
COMMENT ON COLUMN founders.needs_manual_review IS 'True if pattern matching failed and needs manual Hunter.io lookup';
COMMENT ON COLUMN founders.university IS 'University attended (for student matching)';
COMMENT ON COLUMN founders.previous_company IS 'Previous company worked at (for warm intro matching)';

-- Create view for easy querying with startup data
CREATE OR REPLACE VIEW founders_with_startup AS
SELECT
    f.*,
    s.name AS startup_name,
    s.website AS startup_website,
    s.industry AS startup_industry,
    s.location AS startup_location,
    s.funding_amount,
    s.funding_stage,
    s.data_source
FROM founders f
JOIN startups s ON f.startup_id = s.id;

COMMENT ON VIEW founders_with_startup IS 'Founders joined with their startup data for easy querying';

-- Enable Row Level Security (RLS) - same permissions as startups table
ALTER TABLE founders ENABLE ROW LEVEL SECURITY;

-- Create policies (allow all for now, can be restricted later)
CREATE POLICY "Enable read access for all users" ON founders
    FOR SELECT USING (true);

CREATE POLICY "Enable insert for authenticated users only" ON founders
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Enable update for authenticated users only" ON founders
    FOR UPDATE USING (true);

CREATE POLICY "Enable delete for authenticated users only" ON founders
    FOR DELETE USING (true);
