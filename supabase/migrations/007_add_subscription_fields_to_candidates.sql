-- Add subscription-related fields to candidates table
ALTER TABLE candidates
ADD COLUMN IF NOT EXISTS subscription_tier TEXT DEFAULT 'free' CHECK (subscription_tier IN ('free', 'premium')),
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'inactive' CHECK (subscription_status IN ('active', 'inactive', 'canceled', 'past_due', 'trialing')),
ADD COLUMN IF NOT EXISTS subscription_current_period_end TIMESTAMP WITH TIME ZONE;

-- Create index on stripe_customer_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_candidates_stripe_customer_id ON candidates(stripe_customer_id);

-- Create index on subscription_tier for analytics
CREATE INDEX IF NOT EXISTS idx_candidates_subscription_tier ON candidates(subscription_tier);

-- Add comment to document the schema
COMMENT ON COLUMN candidates.subscription_tier IS 'User subscription tier: free (1 match only) or premium (unlimited matches + features)';
COMMENT ON COLUMN candidates.stripe_customer_id IS 'Stripe customer ID for payment management';
COMMENT ON COLUMN candidates.stripe_subscription_id IS 'Stripe subscription ID for the active subscription';
COMMENT ON COLUMN candidates.subscription_status IS 'Current subscription status synced from Stripe webhooks';
COMMENT ON COLUMN candidates.subscription_current_period_end IS 'When the current subscription period ends (for renewal tracking)';
