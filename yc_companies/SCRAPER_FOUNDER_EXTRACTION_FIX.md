# Founder Extraction Fix

## Problem

The scraper was missing founder names that are clearly visible on YC pages (e.g., "Stephen Sun" from mlop). The issue was:

1. **Too strict validation** - Required names to either be in the "Active Founders" section OR have "founder" in the description
2. **CSS selector failures** - The selectors (`.text-xl.font-bold`) might not match the actual DOM structure
3. **Container detection issues** - The logic to find the founders container wasn't working reliably

## Example Case

**Company**: mlop (https://www.ycombinator.com/companies/mlop)
- **Founder**: Stephen Sun
- **Description**: "Building high quality tools for ML engineers" (doesn't contain "founder")
- **Result**: Not extracted because validation was too strict

## Solution

### 1. Relaxed Validation Logic

Changed the validation to be more lenient when we detect the "Active Founders" section:

```typescript
// Before: Required "founder" in description even if in Active Founders section
if (!isInFoundersSection && !hasFounderDescription) return;

// After: Trust names in Active Founders section even without "founder" in description
// If we're in the Active Founders section, trust it - don't require "founder" in description
if (!isInFoundersSection && !hasFounderDescription) return;
```

### 2. Improved Section Detection

Enhanced the logic to detect if a name element is in the "Active Founders" section:

- Checks if element is a descendant of the founders container
- Falls back to checking DOM position (if element appears after heading)
- More reliable detection of section membership

### 3. Enhanced Text-Based Fallback

Added a robust fallback that extracts names using text pattern matching:

- Finds "Active Founders" heading
- Looks at elements after the heading
- Extracts text matching name patterns (First Last, First Middle Last)
- Filters out common words and company names
- Associates LinkedIn links when found

This fallback runs when:
- The CSS selector-based extraction finds no founders
- But we successfully found the "Active Founders" heading

## Testing

To test the fix on a specific company:

```bash
# Test scraping a single company
npx tsx yc_companies/test_scrape_yc_companies.ts --url="https://www.ycombinator.com/companies/mlop"
```

Or use the re-scraping script:

```bash
# Re-scrape companies missing founder data
npm run re-scrape:missing -- --limit=10
```

## Expected Improvements

1. **Higher extraction rate** - Should find founders even when descriptions don't mention "founder"
2. **More reliable** - Text-based fallback works even if CSS classes change
3. **Better coverage** - Catches cases like mlop where founder info is present but extraction failed

## Next Steps

1. **Run re-scraping** on companies missing founder data:
   ```bash
   npm run re-scrape:missing -- --limit=50
   ```

2. **Verify results** in the database using your SQL queries

3. **Check extraction quality** - Some names might need manual review if the text-based extraction is too aggressive

## Related Files

- `scrape_yc_companies.ts` - Main scraper with improved extraction
- `re_scrape_missing_data.ts` - Script to re-scrape missing data
- `test_scrape_yc_companies.ts` - Test script for specific URLs

