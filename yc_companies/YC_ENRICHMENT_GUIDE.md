# YC Startup Enrichment System - User Guide

## Overview

This system scrapes and enriches Y Combinator startup data in three phases:

1. **YC Page Scraping** - Extract founder info, jobs, and company data from YC pages
2. **Funding Data Enrichment** - Find funding information using web search
3. **Hotness Score Calculation** - Calculate a 0-100 score showing how "hot" each startup is

## Quick Start

### Phase 1: Scrape YC Company Pages

Scrape all YC companies from CSV files:

```bash
npm run scrape:yc
```

Scrape only a specific batch:

```bash
npm run scrape:yc:batch -- --batch=summer2025
```

**What it does:**
- Loads companies from `yc_companies/ycombinator*.csv` files
- Scrapes each YC company page using Puppeteer
- Extracts founder names, LinkedIn profiles, website, team size, and job postings
- Stores data in Supabase `startups` table
- Rate limits: 2 seconds between requests
- Automatically skips already-processed companies

**Data Extracted:**
- ✅ Founder first name, last name
- ✅ Founder LinkedIn URL
- ✅ Company website
- ✅ Team size
- ✅ Active job postings
- ✅ Hiring roles with descriptions
- ✅ Location, industry, batch info (from CSV)

### Phase 2: Fetch Funding Data

Enrich startups with funding information:

```bash
npm run funding:fetch
```

**What it does:**
- Finds all YC startups without funding data
- Uses web search agent to find funding information
- Extracts funding amount, stage, and date
- Calculates "hotness" score (0-100)
- Updates Supabase with funding data and hotness score
- Rate limits: 3 seconds between requests

**Data Enriched:**
- 💰 Funding amount (e.g., "$5M", "$20M")
- 📊 Funding stage (Seed, Series A, Series B, etc.)
- 📅 Funding date (when funding was announced)
- 🔥 Hotness score (0-100)

## Hotness Score Explained

The hotness score shows how "hot" a startup is based on multiple factors:

### Score Breakdown (0-100 points)

1. **Funding Amount (0-30 points)**
   - $50M+: 30 points
   - $20-50M: 25 points
   - $10-20M: 20 points
   - $5-10M: 15 points
   - $1-5M: 10 points
   - <$1M: 5 points

2. **Funding Recency (0-30 points)**
   - <3 months ago: 30 points
   - 3-6 months ago: 25 points
   - 6-12 months ago: 20 points
   - 12-24 months ago: 10 points
   - 24-36 months ago: 5 points
   - 36+ months ago: 0 points

3. **Funding Stage (0-30 points)**
   - Series D/E or IPO: 30 points
   - Series C: 25 points
   - Series B: 20 points
   - Series A: 15 points
   - Seed/Pre-seed: 10 points
   - Unknown: 5 points

4. **Team Growth (0-5 points)**
   - 100+ employees: 5 points
   - 51-100 employees: 4 points
   - 21-50 employees: 3 points
   - 6-20 employees: 2 points
   - 1-5 employees: 1 point

5. **Active Hiring (0-5 points)**
   - 10+ job postings: 5 points
   - 6-10 job postings: 4 points
   - 3-5 job postings: 3 points
   - 1-2 job postings: 2 points
   - 0 job postings: 0 points

### Example Hotness Scores

**Very Hot Startup (85/100)**
- Raised $25M Series B 2 months ago (25 + 30 + 20 = 75 points)
- Team of 60 people (4 points)
- 8 active job postings (4 points)
- **Total: 83 points**

**Moderately Hot Startup (50/100)**
- Raised $8M Seed 8 months ago (15 + 20 + 10 = 45 points)
- Team of 12 people (2 points)
- 4 active job postings (3 points)
- **Total: 50 points**

**Cool Startup (25/100)**
- Raised $2M Seed 18 months ago (10 + 10 + 10 = 30 points)
- Team of 5 people (1 point)
- 0 job postings (0 points)
- **Total: 31 points**

## Complete Workflow

Run both phases in sequence:

```bash
# Step 1: Scrape all YC company pages
npm run scrape:yc

# Step 2: Fetch funding data and calculate hotness scores
npm run funding:fetch
```

## Database Schema

The system stores data in the `startups` table:

### YC Scraping Fields
- `name` - Company name
- `description` - Company description
- `location` - Company location
- `website` - Company website
- `industry` - Industry/vertical
- `business_type` - B2B, B2C, etc.
- `batch` - YC batch (e.g., "Summer 2025")
- `yc_link` - YC company page URL
- `yc_slug` - Company slug (for deduplication)
- `company_logo` - Logo URL
- `founder_first_name` - Primary founder first name
- `founder_last_name` - Primary founder last name
- `founder_linkedin` - Primary founder LinkedIn URL
- `team_size` - Number of employees
- `job_openings` - Comma-separated list of job titles
- `hiring_roles` - Full job descriptions
- `data_source` - Set to "yc"

### Funding Enrichment Fields
- `funding_amount` - Amount raised (e.g., "$5M")
- `round_type` - Funding stage (Seed, Series A, etc.)
- `date` - Funding date
- `hotness_score` - Calculated score (0-100)
- `hotness_factors` - JSON breakdown of score components
- `enrichment_status` - "pending" or "completed"

## Rate Limiting & Performance

### YC Scraping
- **Rate limit**: 2 seconds between companies
- **Performance**: ~1000 companies in 3-4 hours
- **Failure handling**: Retries up to 3 times, skips on final failure

### Funding Enrichment
- **Rate limit**: 3 seconds between companies (includes web search delays)
- **Performance**: ~1000 companies in 2-3 hours
- **Failure handling**: Logs errors, continues to next company

## Monitoring Progress

Both scripts output detailed progress:

```
[142/168] 🏢 Processing: CompanyName
   Batch: Summer 2025
   URL: https://www.ycombinator.com/companies/slug
   Found 2 founder(s)
   Website: https://company.com
   Team size: 15
   Job postings: 3
   ✅ Successfully stored in Supabase
```

## Handling Failures

### Common Issues

**Problem**: "Could not extract slug from YC link"
- **Cause**: Malformed YC URL in CSV
- **Fix**: Check CSV file format

**Problem**: "Failed to scrape page data"
- **Cause**: YC page structure changed or connection timeout
- **Fix**: Script will retry automatically, then skip

**Problem**: "No funding data found"
- **Cause**: Company hasn't announced funding publicly
- **Fix**: This is normal for early-stage startups, skip is expected

### Resume Capability

Both scripts automatically skip already-processed companies, so you can safely resume after interruption:

```bash
# Script was interrupted, resume where it left off
npm run scrape:yc

# Continue funding enrichment
npm run funding:fetch
```

## Adding New YC Batches

1. Create a new CSV file in `yc_companies/` directory:
   - Format: `ycombinator - BatchName.csv`
   - Example: `ycombinator - ycWinter2026.csv`

2. CSV should have these columns:
   - `YC_Link` - YC company page URL
   - `Company_Logo` - Logo URL
   - `Company_Name` - Company name
   - `company_description` - Short description
   - `Batch` - Batch name (e.g., "Winter 2026")
   - `business_type` - B2B, Consumer, etc.
   - `industry` - Industry vertical
   - `location` - Company location

3. Run the scraper:
   ```bash
   npm run scrape:yc
   ```

The script will automatically detect and process the new CSV file.

## Testing

Test on a small batch first:

```bash
# Test on Summer 2025 (168 companies)
npm run scrape:yc:batch -- --batch=summer2025

# Then test funding enrichment (will only process the scraped companies)
npm run funding:fetch
```

## Next Steps

After enrichment is complete:

1. **Verify Data Quality**
   - Check Supabase to ensure data looks correct
   - Verify hotness scores make sense
   - Check that founder LinkedIn URLs are valid

2. **Use Hotness Scores**
   - Sort companies by hotness_score DESC
   - Filter for hotness_score > 70 for "very hot" startups
   - Use factors breakdown to understand why a startup is hot

3. **Match with Candidates**
   - Use `job_openings` and `hiring_roles` fields
   - Match candidate skills against required_skills (if extracted)
   - Recommend hot startups that match candidate profiles

## Troubleshooting

### Script hangs during scraping
- **Cause**: Browser process stuck
- **Fix**: Kill the process (Ctrl+C) and restart. Already-processed companies will be skipped.

### No funding data for most companies
- **Cause**: Early-stage YC companies often haven't announced funding publicly
- **Fix**: This is expected. Focus on companies with funding data, or use other hotness factors (team size, job postings).

### Hotness scores seem too low
- **Cause**: Missing funding data reduces scores
- **Fix**: Scores without funding can still be meaningful based on team growth and hiring activity.

## Support

For issues or questions:
1. Check the console output for detailed error messages
2. Verify Supabase connection and schema
3. Ensure `.env.local` has correct credentials
4. Check that Puppeteer can launch browser (may require system dependencies)
