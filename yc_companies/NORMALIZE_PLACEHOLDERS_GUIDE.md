# Normalize Placeholders Guide

## Problem

The database contains placeholder/default values (like "Team", "$1.5M", "hello@domain.com") that make it hard to distinguish between:
- **Real data** that has been enriched
- **Placeholder data** that needs to be replaced

## Solution

**Normalize placeholder values to NULL first**, then mark startups for re-enrichment based on NULL values only.

This approach:
- ✅ Separates "has real data" from "needs data" 
- ✅ Makes re-enrichment criteria clearer and less aggressive
- ✅ Prevents marking startups that already have real data

## Workflow

### Step 1: Normalize Placeholder Values to NULL

First, convert all placeholder values to NULL:

```bash
# See what would be normalized (dry run)
npm run normalize:placeholders

# Actually normalize the values
npm run normalize:placeholders:auto
```

This script will:
- Find placeholder values like:
  - `founder_names: "Team"` → `NULL`
  - `founder_emails: "hello@domain.com"` → `NULL`
  - `funding_amount: "$1.5M"` → `NULL`
  - `round_type: "Seed"` (if funding_amount is also placeholder) → `NULL`
- Set them to `NULL` in the database

### Step 2: Mark Startups for Re-Enrichment

After normalization, mark startups based on NULL values:

```bash
# See what would be marked (dry run)
npm run enrich:mark

# Actually mark them
npm run enrich:mark:auto
```

**Important**: Only run this AFTER normalizing placeholders!

### Step 3: Enrich Startups

Process the marked startups:

```bash
npm run enrich-startups 50    # Start with 50
npm run enrich:bulk            # Then 100 at a time
```

## What Gets Normalized

### Founder Names
- `"Team"` → `NULL`
- `"founder"` → `NULL`
- `"n/a"` → `NULL`

### Founder Emails
- `"hello@domain.com"` → `NULL`
- Any email with `example.com` or `test.com` → `NULL`

### Funding Amounts
- `"$1.5M"` or `"$1.5 M"` → `NULL`
- `"$500K-$2M"` (default range) → `NULL`

### Funding Stages
- `"Seed"` → `NULL` (only if funding_amount is also placeholder)

## Updated Mark Criteria

After normalization, the mark script only checks for **NULL/missing values**:

### Critical Fields (mark if missing)
- `founder_names` is NULL
- `founder_emails` is NULL  
- `funding_amount` is NULL

### Important Fields (mark if 2+ missing)
- `founder_linkedin` is NULL
- `tech_stack` is NULL
- `founder_backgrounds` is NULL
- `website_keywords` is NULL

### Marking Logic
- **High Priority**: 2+ critical fields missing
- **Medium Priority**: 1 critical field OR 3+ important fields missing
- **Low Priority**: 2+ important fields missing

A startup is marked if:
- 1+ critical field is missing, OR
- 2+ total fields (critical + important) are missing

## Benefits

1. **Cleaner Data**: Placeholders are clearly NULL, making it obvious what needs data
2. **Less Aggressive**: Only marks startups that actually need enrichment
3. **Better Tracking**: Can distinguish between "never enriched" vs "enriched but got placeholder"
4. **Easier Queries**: SQL queries can simply check `IS NULL` instead of pattern matching

## Example

### Before Normalization:
```sql
SELECT name, founder_names, funding_amount 
FROM startups 
WHERE founder_names = 'Team' OR funding_amount = '$1.5M';
-- Hard to tell which are placeholders vs real data
```

### After Normalization:
```sql
SELECT name, founder_names, funding_amount 
FROM startups 
WHERE founder_names IS NULL OR funding_amount IS NULL;
-- Clear: these need enrichment
```

## Best Practices

1. **Always normalize first**: Run `normalize:placeholders:auto` before marking
2. **Check results**: Review what was normalized before proceeding
3. **Run in order**: Normalize → Mark → Enrich
4. **Monitor**: Use SQL queries to track NULL vs populated fields

## SQL Queries for Monitoring

```sql
-- Count NULL values after normalization
SELECT 
  COUNT(*) as total,
  COUNT(CASE WHEN founder_names IS NULL THEN 1 END) as null_founder_names,
  COUNT(CASE WHEN founder_emails IS NULL THEN 1 END) as null_founder_emails,
  COUNT(CASE WHEN funding_amount IS NULL THEN 1 END) as null_funding_amount,
  COUNT(CASE WHEN tech_stack IS NULL THEN 1 END) as null_tech_stack
FROM startups;

-- Find startups still needing enrichment after normalization
SELECT 
  name,
  founder_names,
  funding_amount,
  tech_stack
FROM startups
WHERE 
  founder_names IS NULL 
  OR funding_amount IS NULL
  OR tech_stack IS NULL
ORDER BY created_at DESC;
```


