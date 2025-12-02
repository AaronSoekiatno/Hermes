# Enhanced Founder Extraction - LinkedIn & Background

## Overview

The scraper has been enhanced to apply the same relaxed validation logic to:
1. **Founder Names** - Already improved
2. **Founder LinkedIn Links** - Now uses broader search
3. **Founder Backgrounds/Descriptions** - Now accepts descriptive text even without "founder" keyword

## Key Improvements

### 1. LinkedIn Link Extraction - Broader Search

**Before**: Only searched in the immediate founder card element

**After**: Multi-level search strategy:
- First: Searches in the founder card itself
- Second: Searches in parent containers (up to 5 levels)
- Third: If in Active Founders section, searches for closest LinkedIn link in the entire founders container
- Uses distance calculation to find the most relevant link

This ensures LinkedIn links are found even when they're not directly in the same DOM element as the name.

### 2. Background/Description Extraction - Relaxed Validation

**Before**: Required descriptions to mention "founder" or "co-founder"

**After**: In Active Founders section:
- Accepts any descriptive text that looks like a bio
- Looks for bio indicators: "Prior", "studied", "worked", "led", "Building", "Previously", "Experience"
- Also accepts text with patterns like "at", "from", "co-founded"
- Searches in multiple places: paragraphs, div elements, parent containers

**Example**: For mlop's founder with description "Building high quality tools for ML engineers" - this will now be extracted even though it doesn't mention "founder".

### 3. Fallback Extraction - Complete Data

The text-based fallback now extracts:
- ✅ Founder names (using pattern matching)
- ✅ LinkedIn links (searches nearby elements)
- ✅ Backgrounds/descriptions (extracts bio-like text)

## Code Changes

### LinkedIn Extraction (Lines 385-437)
- Multi-level container search
- Closest-link matching in Active Founders section
- Distance-based association between names and links

### Description Extraction (Lines 308-383)
- Relaxed validation for Active Founders section
- Multiple fallback strategies
- Parent container search when needed
- Accepts bio-like text without requiring "founder" keyword

### Fallback Extraction (Lines 495-595)
- Enhanced to extract LinkedIn links from nearby elements
- Enhanced to extract descriptions/backgrounds from paragraphs and div text
- Complete founder data even when CSS selectors fail

## Testing

Test the enhanced extraction:

```bash
# Test on a specific company
npx tsx yc_companies/test_scrape_yc_companies.ts --url="https://www.ycombinator.com/companies/mlop"

# Re-scrape companies missing data
npm run re-scrape:missing -- --limit=10
```

## Expected Results

1. **Higher LinkedIn extraction rate** - Links found even when not directly in same element
2. **More complete backgrounds** - Descriptive text extracted even without "founder" keyword
3. **Better data quality** - All three fields (names, LinkedIn, backgrounds) extracted together

## Related Files

- `scrape_yc_companies.ts` - Enhanced scraper with improved extraction
- `re_scrape_missing_data.ts` - Script to fill in missing data
- `SCRAPER_FOUNDER_EXTRACTION_FIX.md` - Original founder name extraction fix

