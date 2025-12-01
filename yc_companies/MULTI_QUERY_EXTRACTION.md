# Multi-Query Extraction System

## Overview

The enrichment system has been upgraded to use **multiple targeted queries** instead of a single comprehensive query. This provides better accuracy and more reliable data extraction.

## What Changed

### Old Approach (Single Query)
- One big search: `"CompanyName startup founders team website"`
- Extract everything from one set of results
- Less accurate, prone to missing information

### New Approach (4 Targeted Queries)
1. **Company Overview** → website, industry, location, target customer, market vertical
2. **Funding Information** → funding amount, round type, funding date
3. **Team Information** → founders, LinkedIn, backgrounds, team size
4. **Jobs & Skills** → hiring roles, required skills from job postings

## Key Improvements

### 1. Tech Stack → Required Skills
**Old:** Tried to guess tech stack from general company descriptions (unreliable)

**New:** Extract **required_skills** from actual job postings
- More accurate - shows what technologies they actually use
- Better for matching candidates to companies
- Falls back to tech blog/engineering content if no job listings exist

**Example:**
```
Job Listing: "Senior Engineer - Python, React, AWS, PostgreSQL"
→ Extracted: "Python, React, AWS, PostgreSQL"
```

### 2. Added Funding Date
Now extracts when the funding was announced:
- Format: `YYYY-MM-DD`, `YYYY-MM`, or `YYYY`
- Validated to ensure it's a real date (2000-2030)

### 3. Smarter Search Queries

**Query 1: Company Overview**
```
"CompanyName startup company official website"
```
→ Finds: website domain, industry, location, business model

**Query 2: Funding**
```
"CompanyName funding raised investment round"
```
→ Finds: funding amount, stage (Seed/Series A/B/C), announcement date

**Query 3: Team**
```
"CompanyName founder CEO team LinkedIn"
```
→ Finds: founder names, LinkedIn profiles, previous experience, team size

**Query 4: Jobs & Skills**
```
"CompanyName careers jobs hiring open positions"
```
→ Finds: open roles, required technical skills

**Fallback (if no job listings):**
```
"CompanyName engineering blog technology stack architecture"
```
→ Extracts technologies mentioned in engineering content (lower confidence)

## How It Handles Companies Without Job Listings

Many early-stage startups don't have public job listings. The system handles this gracefully:

1. **First:** Try to extract skills from job postings (confidence: 0.7-0.9)
2. **If no jobs found:** Search for engineering blogs/tech content
3. **Extract:** Technologies mentioned in technical discussions (confidence: 0.5)
4. **If still nothing:** Leave `required_skills` empty rather than hallucinating

This is MUCH better than the old approach which would guess tech stack based on industry (e.g., assuming all fintech companies use the same stack).

## Database Schema Updates

Run the migration:
```bash
# Apply migration
supabase migration up
```

**New Fields:**
- `required_skills` TEXT - Skills from job postings or tech content
- `funding_date` TEXT - Date of funding announcement

**Deprecated Fields:**
- `tech_stack` - Replaced by `required_skills`

## Validation & Anti-Hallucination

All extracted data goes through strict validation:

### Funding Amount
- Must match format: `$20M`, `$1.5B`
- Rejects: generic amounts, placeholders

### Funding Date
- Must match: `YYYY-MM-DD`, `YYYY-MM`, or `YYYY`
- Year range: 2000-2030
- Rejects: invalid dates, future dates

### Required Skills
- Must be actual technologies (Python, React, AWS, etc.)
- Rejects: soft skills (teamwork, communication)
- Rejects: generic terms (technology, stack, tools)

### Confidence Thresholds
- 0.9+ → Information stated multiple times
- 0.7-0.8 → Information clearly stated once
- 0.5-0.6 → Information implied/inferred
- Below 0.7 → Rejected (except for fallback skills)

## Usage

The system automatically uses the new multi-query approach:

```typescript
// Automatically called by enrichStartup()
const data = await searchWebForStartup(startup);

// Returns EnrichedData with:
// - required_skills (from job postings or tech content)
// - funding_date (when funding was announced)
// - All other fields as before
```

## Matching Candidates to Companies

With the new `required_skills` field, you can now:

1. **Extract skills from job postings** → Know exactly what they're hiring for
2. **Match candidate skills** → Compare against required_skills
3. **Better recommendations** → Match people with relevant experience

**Example:**
```
Startup: "Stripe-like payment platform"
Required Skills: "Python, React, AWS, PostgreSQL, Stripe API"

Candidate: Python engineer with AWS experience
→ Strong match!
```

## Benefits

✅ **More accurate** - Targeted queries get better results
✅ **Real skills** - From actual job postings, not guesses
✅ **Funding dates** - Know when funding was announced
✅ **Graceful fallback** - Handles companies without job listings
✅ **Higher confidence** - Each query optimized for specific data
✅ **Better matching** - Match candidates to actual job requirements

## Migration Guide

If you have existing data with `tech_stack`:

1. Run migration: `supabase migration up`
2. Optional: Migrate old data: `UPDATE startups SET required_skills = tech_stack WHERE tech_stack IS NOT NULL`
3. Re-enrich companies: `npm run enrich-startups`

The new system will populate `required_skills` and `funding_date` automatically.
