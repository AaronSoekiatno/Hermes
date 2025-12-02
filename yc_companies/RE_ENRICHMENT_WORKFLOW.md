# Re-Enrichment Workflow

## Overview

This workflow normalizes placeholder values to NULL first, then marks startups for re-enrichment based on missing data. This prevents marking startups that already have real data.

## Three-Step Process

### Step 1: Normalize Placeholder Values

Convert placeholder/default values to NULL:

```bash
# Preview what will be normalized
npm run normalize:placeholders

# Actually normalize (set placeholders to NULL)
npm run normalize:placeholders:auto
```

**What gets normalized:**
- `founder_names: "Team"` → `NULL`
- `founder_emails: "hello@domain.com"` → `NULL`
- `funding_amount: "$1.5M"` → `NULL`
- `round_type: "Seed"` → `NULL` (if funding_amount was also placeholder)

### Step 2: Mark Startups for Re-Enrichment

Mark startups based on NULL values (only after normalization):

```bash
# Preview what will be marked
npm run enrich:mark

# Actually mark startups
npm run enrich:mark:auto
```

**Marking criteria:**
- Marks if 1+ critical field is NULL (founder_names, founder_emails, funding_amount)
- OR if 2+ total fields (critical + important) are NULL

### Step 3: Enrich Startups

Process marked startups:

```bash
# Process in batches
npm run enrich-startups 50    # Start small
npm run enrich:bulk            # Then 100 at a time
```

## Why This Approach?

### Problem with Old Approach
- Marked every startup because it checked for placeholder strings
- Couldn't distinguish between "has real data" vs "has placeholder"
- Too aggressive - marked startups that were already enriched

### Benefits of Normalize-First Approach
1. ✅ **Clear separation**: NULL = missing, non-NULL = has data
2. ✅ **Less aggressive**: Only marks startups that actually need data
3. ✅ **Better tracking**: Can see what's missing vs what's populated
4. ✅ **Easier queries**: Simple `IS NULL` checks instead of pattern matching

## Complete Example

```bash
# 1. Normalize placeholders first
npm run normalize:placeholders:auto

# 2. Then mark for re-enrichment
npm run enrich:mark:auto

# 3. Process in batches
npm run enrich-startups 50
npm run enrich-startups 50
npm run enrich-startups 50
# ... continue until done

# 4. Verify progress
npm run enrich:mark  # Should show fewer startups needing enrichment
```

## SQL Monitoring

```sql
-- Check NULL counts after normalization
SELECT 
  COUNT(CASE WHEN founder_names IS NULL THEN 1 END) as null_founder_names,
  COUNT(CASE WHEN funding_amount IS NULL THEN 1 END) as null_funding_amount,
  COUNT(CASE WHEN tech_stack IS NULL THEN 1 END) as null_tech_stack
FROM startups;

-- Check how many still need enrichment
SELECT COUNT(*) 
FROM startups 
WHERE needs_enrichment = true;
```

## Files

- `normalize_placeholder_values.ts` - Converts placeholders to NULL
- `mark_startups_for_re_enrichment.ts` - Marks startups based on NULL values
- `enrich_startup_data.ts` - Processes enrichment (already existed)

## Key Insight

**Always normalize placeholders to NULL before marking for re-enrichment!**

This ensures:
- Real data is preserved
- Only missing data gets marked
- Clear distinction between "missing" and "populated"


