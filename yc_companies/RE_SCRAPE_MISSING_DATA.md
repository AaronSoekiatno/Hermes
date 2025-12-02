# Re-scrape Missing Data from YC Pages

## Problem

Many startups in the database are missing critical fields that should have been extracted from YC pages:
- **531 startups** missing founder names
- **579 startups** missing founder emails  
- **185 startups** missing website

The information exists on the YC pages, but it wasn't properly scraped or synthesized.

## Solution

The `re_scrape_missing_data.ts` script:

1. **Identifies** startups missing critical fields (founder names, emails, website)
2. **Re-scrapes** their YC pages using the existing scraper
3. **Updates** existing database records with the missing data (no duplicates)
4. **Optionally discovers emails** using pattern matching + email verification

## Usage

### Basic Usage

```bash
# Re-scrape all startups missing data
npm run re-scrape:missing

# Process only 50 startups at a time
npm run re-scrape:missing -- --limit=50

# Only fix specific fields
npm run re-scrape:missing -- --fields=founder_names,website

# Skip email discovery (just scrape what's on the page)
npm run re-scrape:missing -- --skip-email-discovery
```

### Advanced Options

```bash
# Process 100 startups, skip email discovery
npx tsx yc_companies/re_scrape_missing_data.ts --limit=100 --skip-email-discovery

# Only fix founder names and emails
npx tsx yc_companies/re_scrape_missing_data.ts --fields=founder_names,founder_emails
```

## What It Does

### 1. Finds Missing Data

The script queries the database for startups that are:
- Missing `website` (NULL or empty)
- Missing `founder_names` AND `founder_first_name` (both NULL/empty)
- Missing `founder_emails` (NULL or empty)

It filters to only YC startups that have a valid `yc_link`.

### 2. Re-scrapes YC Pages

For each startup missing data:
- Opens the YC company page using Puppeteer
- Extracts:
  - Founder names and LinkedIn URLs
  - Website URL
  - Location
  - Other available data

### 3. Updates Database

The script **updates existing records** (doesn't create duplicates):
- Updates only missing fields
- Preserves existing data in other fields
- Uses the same scraper logic as the initial scrape

### 4. Email Discovery (Optional)

If founder names and website are found, the script can:
- Generate email patterns (first@domain, first.last@domain, etc.)
- Verify emails using Rapid Email Verifier API
- Update `founder_emails` with verified addresses

**Note**: Email discovery can be disabled with `--skip-email-discovery` if you want to only use emails found directly on the YC page.

## Field Priority

The script prioritizes filling in:
1. **Website** - Critical for contact and enrichment
2. **Founder Names** - Critical for outreach
3. **Founder Emails** - Can be discovered if names + website exist

## Rate Limiting

- **2 second delay** between startups (respects YC's servers)
- **Email verification** uses unlimited API (no rate limits)
- Process in batches using `--limit` to avoid overwhelming the system

## Example Output

```
🔄 Re-scraping Missing Data from YC Pages

✓ Connected to Supabase

🔍 Finding startups missing critical data...

📊 Found 531 startups missing critical data

📋 Missing data breakdown:
   Missing website: 185
   Missing founder names: 531
   Missing founder emails: 579

🌐 Launching browser...

[1/531] 🏢 Processing: Example Startup
   Missing: website, founder_names, founder_emails
   🔍 Scraping: https://www.ycombinator.com/companies/example-startup
   Found 2 founder(s)
   Website: example.com
   📧 Discovering emails for founders @ example.com...
   ✅ Found 2 email(s)
   ✅ Updated database

...

📊 Re-scraping Complete
============================================================
Total processed: 531
Successfully scraped: 523
Updated in database: 523
Emails enriched: 485
Errors: 8
============================================================
```

## Workflow

### Recommended Approach

1. **Start with a small batch** to test:
   ```bash
   npm run re-scrape:missing -- --limit=10
   ```

2. **Check the results** in your database

3. **Process in larger batches**:
   ```bash
   npm run re-scrape:missing -- --limit=100
   ```

4. **Run multiple times** if you hit rate limits or want to process incrementally

### For Large Datasets

For 500+ startups, run in batches:

```bash
# Batch 1: First 100
npm run re-scrape:missing -- --limit=100

# Batch 2: Next 100
npm run re-scrape:missing -- --limit=100

# Continue until all are processed
```

## Troubleshooting

### "Failed to scrape page data"

- YC page might be down or changed structure
- Check if the `yc_link` is valid
- The startup might have been removed from YC

### "No new data to update"

- The scraper didn't find the missing data on the page
- The data might not exist on the YC page
- Try manually checking the YC page

### Email Discovery Fails

- If pattern matching fails, emails might not follow common patterns
- Use `--skip-email-discovery` to only use emails found on YC pages
- Consider manual enrichment for high-priority startups

## Next Steps

After re-scraping:

1. **Verify the data** using your SQL queries
2. **Mark for re-enrichment** if other fields need updating:
   ```bash
   npm run enrich:mark:auto
   ```

3. **Run enrichment** for additional fields:
   ```bash
   npm run enrich-startups 100
   ```

## Related Scripts

- `scrape_yc_companies.ts` - Initial YC scraping
- `enrich_founder_emails.ts` - Batch email enrichment
- `mark_startups_for_re_enrichment.ts` - Mark startups needing enrichment
- `enrich_startup_data.ts` - Full enrichment workflow

