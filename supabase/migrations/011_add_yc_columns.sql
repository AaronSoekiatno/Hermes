-- Add YC-specific columns to startups table
ALTER TABLE startups ADD COLUMN IF NOT EXISTS yc_link TEXT;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS batch TEXT;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS company_logo TEXT;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS business_type TEXT;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS founder_first_name TEXT;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS founder_last_name TEXT;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS team_size TEXT;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS hiring_roles TEXT;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS data_source TEXT;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS needs_enrichment BOOLEAN DEFAULT true;
ALTER TABLE startups ADD COLUMN IF NOT EXISTS enrichment_status TEXT DEFAULT 'pending';


-- Create index on yc_link for faster deduplication
CREATE INDEX IF NOT EXISTS idx_startups_yc_link ON startups(yc_link);
CREATE INDEX IF NOT EXISTS idx_startups_batch ON startups(batch);
CREATE INDEX IF NOT EXISTS idx_startups_data_source ON startups(data_source);
CREATE INDEX IF NOT EXISTS idx_startups_enrichment_status ON startups(enrichment_status);

-- Add comment explaining the columns
COMMENT ON COLUMN startups.yc_link IS 'Y Combinator company page URL';
COMMENT ON COLUMN startups.batch IS 'YC batch (e.g., Winter 2025, Summer 2024)';
COMMENT ON COLUMN startups.company_logo IS 'Company logo URL';
COMMENT ON COLUMN startups.business_type IS 'Business type (B2B, B2C, etc.)';
COMMENT ON COLUMN startups.founder_first_name IS 'Primary founder first name';
COMMENT ON COLUMN startups.founder_last_name IS 'Primary founder last name';
COMMENT ON COLUMN startups.team_size IS 'Number of employees';
COMMENT ON COLUMN startups.hiring_roles IS 'Active job postings with descriptions';
COMMENT ON COLUMN startups.data_source IS 'Data source (yc, techcrunch, etc.)';
COMMENT ON COLUMN startups.needs_enrichment IS 'Whether startup needs funding/skills enrichment';
COMMENT ON COLUMN startups.enrichment_status IS 'Enrichment status (pending, in_progress, completed, failed)';
