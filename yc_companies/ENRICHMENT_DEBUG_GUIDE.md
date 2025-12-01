# Enrichment Debug Guide

## Problem
After running the enrichment script, many fields remain null or have placeholder values like "Team" even though enrichment_status is "completed".

## What Was Fixed

### 1. Added Better Logging
- Now logs what data was extracted from web search
- Shows which fields will be updated
- Helps identify if extraction is failing vs merge logic

### 2. Improved Merge Logic
- Added `.trim()` checks to ensure empty strings aren't treated as valid data
- Better handling of placeholder values like "Team"

### 3. Added Missing Field
- Added `website_keywords` to EnrichedData interface and mapping

## Debugging Steps

### Step 1: Check What Was Extracted
When you run the enrichment, look for this log:
```
🔍 Extracted data: founder_names=John Doe, website=nuntius.com, ...
```

**If this shows "none" or very few fields:**
- The web search/LLM extraction isn't finding data
- Check if Gemini API key is set
- Check if quota is exceeded (you'll see a warning)
- The company might not have much web presence

**If this shows many fields:**
- Extraction is working, but merge logic might be failing
- Check the next log

### Step 2: Check What Will Be Updated
Look for this log:
```
📝 Will update: founder_names, website, tech_stack, ...
```

**If this shows "No updates to apply":**
- Either no data was extracted
- OR all fields already have values (not placeholders)
- Check if existing values are placeholders that should be overwritten

### Step 3: Check Placeholder Detection
The code should detect placeholders like:
- `founder_names: "Team"` → Should be replaced
- `founder_emails: "hello@..."` → Should be replaced (handled by email discovery)

### Step 4: Check Database Update
Look for this log:
```
✅ Enriched with: founder_names, website, tech_stack
```

**If fields aren't in this list but were in "Will update":**
- Database update might be failing
- Check for errors about missing columns
- Check if columns exist in database schema

## Common Issues

### Issue 1: LLM Returns Empty Strings
**Symptom:** Extraction log shows fields but values are empty strings
**Solution:** LLM might not be finding information. The company might have limited web presence.

### Issue 2: Placeholder Not Being Replaced
**Symptom:** `founder_names` is still "Team" after enrichment
**Solution:** Check if extraction found real founder names. If not, the company might not have public founder info.

### Issue 3: Fields Not Saving to Database
**Symptom:** Extraction and merge work, but database doesn't update
**Solution:** 
- Check if column exists in database (run migrations)
- Check for database errors in logs
- Check if field is in `knownColumns` list

## Fields That Should Be Extracted

From the database schema, these fields should be populated:
- ✅ `founder_names` (replace "Team" if found)
- ✅ `founder_linkedin`
- ✅ `tech_stack`
- ✅ `founder_backgrounds`
- ✅ `website_keywords`
- ✅ `team_size` (already has value in your data)
- ✅ `target_customer` (already has value)
- ✅ `market_vertical` (already has value)

## Testing the Fix

Run enrichment on a single startup:
```bash
npm run enrich -- --id=5c7105fc-859c-4d84-b128-74ddbefb2f8c
```

Check the logs for:
1. What was extracted
2. What will be updated
3. What was actually saved

If fields are still null after this, the issue is likely:
- Web search isn't finding data for this company
- LLM extraction is failing
- Company has limited web presence


