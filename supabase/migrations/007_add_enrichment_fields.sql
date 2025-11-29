-- Migration to add enrichment fields extracted by web_search_agent
-- These fields will be populated after TechCrunch scraping via web search enrichment

-- Add tech_stack column
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'startups' 
        AND column_name = 'tech_stack'
    ) THEN
        ALTER TABLE startups ADD COLUMN tech_stack TEXT;
        COMMENT ON COLUMN startups.tech_stack IS 'Technology stack used by the company (comma-separated)';
    END IF;
END $$;

-- Add target_customer column
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'startups' 
        AND column_name = 'target_customer'
    ) THEN
        ALTER TABLE startups ADD COLUMN target_customer TEXT;
        COMMENT ON COLUMN startups.target_customer IS 'Target customer segment (e.g., SMBs, Enterprise, Consumers)';
    END IF;
END $$;

-- Add market_vertical column (more specific than industry)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'startups' 
        AND column_name = 'market_vertical'
    ) THEN
        ALTER TABLE startups ADD COLUMN market_vertical TEXT;
        COMMENT ON COLUMN startups.market_vertical IS 'Specific market vertical (e.g., Fintech - Payments, Healthcare - Telemedicine)';
    END IF;
END $$;

-- Add team_size column
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'startups' 
        AND column_name = 'team_size'
    ) THEN
        ALTER TABLE startups ADD COLUMN team_size TEXT;
        COMMENT ON COLUMN startups.team_size IS 'Team size (e.g., "10-50", "50-200", "200+")';
    END IF;
END $$;

-- Add founder_backgrounds column (different from founder_names - this is about their experience)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'startups' 
        AND column_name = 'founder_backgrounds'
    ) THEN
        ALTER TABLE startups ADD COLUMN founder_backgrounds TEXT;
        COMMENT ON COLUMN startups.founder_backgrounds IS 'Founder backgrounds and previous experience (comma-separated)';
    END IF;
END $$;

-- Add website_keywords column (keywords extracted from website, different from general keywords)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'startups' 
        AND column_name = 'website_keywords'
    ) THEN
        ALTER TABLE startups ADD COLUMN website_keywords TEXT;
        COMMENT ON COLUMN startups.website_keywords IS 'Keywords extracted from company website (comma-separated)';
    END IF;
END $$;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_startups_tech_stack ON startups USING gin(to_tsvector('english', tech_stack));
CREATE INDEX IF NOT EXISTS idx_startups_target_customer ON startups(target_customer);
CREATE INDEX IF NOT EXISTS idx_startups_market_vertical ON startups(market_vertical);
CREATE INDEX IF NOT EXISTS idx_startups_team_size ON startups(team_size);

