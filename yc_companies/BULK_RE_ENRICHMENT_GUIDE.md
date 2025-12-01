# Bulk Re-Enrichment Guide

This guide explains how to use the new bulk re-enrichment tools to fix placeholder and incomplete data in your startups database.

## Problem

Many startups in the database have placeholder or incomplete data from early versions of the app:
- **Founder names**: "Team" instead of real names
- **Founder emails**: "hello@domain.com" (generic pattern)
- **Funding amounts**: "$1.5M" (default placeholder)
- **Funding stages**: "Seed" (may be default, especially if combined with placeholder amount)
- **Missing fields**: tech_stack, founder_backgrounds, website_keywords

## Solution

We've created scripts to:
1. **Identify** all startups with placeholder/incomplete data
2. **Mark** them for re-enrichment
3. **Process** them in batches to extract real data

## Step-by-Step Workflow

### Step 1: Identify Startups Needing Re-Enrichment

First, see what needs to be fixed (no changes made):

```bash
npm run enrich:mark
```

This will show you:
- How many startups need re-enrichment
- Priority breakdown (high/medium/low)
- Sample startups with reasons

### Step 2: Mark All Startups for Re-Enrichment

Once you're ready, automatically mark all problematic startups:

```bash
npm run enrich:mark:auto
```

This will:
- ✅ Identify all startups with placeholder/incomplete data
- ✅ Mark them with `needs_enrichment = true` and `enrichment_status = 'pending'`
- ✅ Process in batches of 100

### Step 3: Process Startups in Batches

Start with a small batch to test:

```bash
npm run enrich-startups 50
```

Or use the bulk command:

```bash
npm run enrich:bulk
```

This processes 100 startups. You can specify any limit:

```bash
npm run enrich-startups 200
```

**Note**: The script processes startups with a 2-second delay between each to avoid rate limiting.

## What Gets Fixed

### Placeholder Detection

The scripts detect and replace:

1. **Founder Names**
   - "Team" → Real founder names from web search

2. **Founder Emails**
   - "hello@domain.com" → Real emails (handled by email discovery module)

3. **Funding Amounts**
   - "$1.5M", "$1.5 M" → Real funding amounts from search

4. **Funding Stages**
   - Generic "Seed" (when combined with placeholder amount) → More specific stages

5. **Missing Fields**
   - tech_stack, founder_backgrounds, website_keywords → Extracted from web search

### Improved Merge Logic

The enrichment script now:
- ✅ Detects placeholder funding amounts and stages
- ✅ Overwrites placeholders with real extracted data
- ✅ Only updates if extracted data is not also a placeholder
- ✅ Logs all updates for transparency

## Monitoring Progress

### Check How Many Still Need Enrichment

Run the mark script again to see remaining issues:

```bash
npm run enrich:mark
```

### SQL Queries

You can also check directly in Supabase:

```sql
-- Count startups still needing enrichment
SELECT COUNT(*) as needing_enrichment
FROM startups
WHERE needs_enrichment = true;

-- Show enrichment status breakdown
SELECT 
  enrichment_status,
  COUNT(*) as count
FROM startups
GROUP BY enrichment_status;

-- Find startups still with placeholder funding
SELECT COUNT(*) as with_placeholder_funding
FROM startups
WHERE funding_amount = '$1.5M' OR funding_amount = '$1.5 M';
```

## Priority Levels

Startups are categorized by priority:

- **🔴 High Priority**: Missing 2+ critical fields (founder info, funding)
- **🟡 Medium Priority**: Missing 1 critical field OR 3+ important fields
- **🟢 Low Priority**: Missing 2+ important fields (tech_stack, backgrounds, etc.)

The mark script processes high priority startups first.

## Best Practices

1. **Start Small**: Test with 50 startups first
2. **Monitor Rate Limits**: The 2-second delay helps, but watch for API errors
3. **Run in Batches**: Process 50-100 at a time, then check results
4. **Re-run Mark Script**: After processing, check if more startups need attention
5. **Check Quality Scores**: The enrichment script calculates quality scores - use these to identify problem cases

## Troubleshooting

### "No startups need enrichment"
- Either all startups are already enriched, or
- You need to run `npm run enrich:mark:auto` first to mark them

### Rate Limiting Errors
- The script has a 2-second delay built in
- If you still hit limits, process smaller batches (e.g., 20 at a time)
- Check your API quotas for Gemini and search APIs

### Placeholder Data Not Being Replaced
- Make sure you're using the updated `enrich_startup_data.ts` with placeholder detection
- Check logs - the script shows what's being updated
- Verify the enrichment actually found data (check quality scores)

## Scripts Reference

| Command | Description |
|---------|-------------|
| `npm run enrich:mark` | Show what would be marked (dry run) |
| `npm run enrich:mark:auto` | Mark all startups needing re-enrichment |
| `npm run enrich-startups [limit]` | Process startups (default: all pending) |
| `npm run enrich:bulk` | Process 100 startups |
| `npm run enrich-startup --id=<uuid>` | Enrich a specific startup by ID |

## Next Steps

After bulk re-enrichment:

1. ✅ Review quality scores to identify remaining issues
2. ✅ Manually fix any remaining problematic startups
3. ✅ Consider running email discovery for companies with missing emails
4. ✅ Update your ingestion scripts to prevent placeholder data in future

## Questions?

- Check enrichment logs for specific errors
- Review quality scores to understand data completeness
- Run SQL queries to monitor progress
- Re-run the mark script periodically to catch new issues

