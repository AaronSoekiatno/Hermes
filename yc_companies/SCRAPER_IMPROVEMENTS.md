# YC Company Scraper Improvements

## Summary of Changes

This document describes the enhancements made to `scrape_yc_companies.ts` to better extract data from YC company pages.

## What Was Changed

### 1. **Enhanced Founder Extraction with Descriptions**

**Before:**
- Only extracted founder names and LinkedIn URLs
- Used generic CSS selectors that often failed
- No founder bio/description extraction

**After:**
- Extracts founder descriptions/bios from the page
- Uses pattern matching to find founder cards (looks for repeated name patterns)
- Falls back to text pattern matching if structured selectors fail
- Stores founder descriptions in `founder_backgrounds` column

**Implementation:**
- Looks for "Founders" or "Active Founders" section
- Identifies founder cards by finding repeated name patterns (founders often have their name displayed twice)
- Extracts bio text from paragraphs containing keywords like "Prior to", "Before", "studied", "worked", "led"
- Falls back to regex pattern matching if structured extraction fails

### 2. **Jobs Page Scraping**

**Before:**
- Only scraped jobs from the main company page
- Often missed jobs listed on separate `/jobs` page

**After:**
- Automatically detects if a jobs page exists (`/companies/[slug]/jobs`)
- Scrapes the jobs page if fewer than 3 jobs found on main page
- Extracts job locations from job listings
- Merges jobs from both pages (avoids duplicates)

**Implementation:**
- Checks for jobs page link after scraping main page
- Navigates to jobs page if found
- Extracts job titles, descriptions, and locations
- Uses deduplication to avoid storing the same job twice

### 3. **Improved Selectors and Extraction**

**Before:**
- Generic selectors like `[class*="founder"]` that matched too many elements
- Simple text search for team size and location
- No scrolling to trigger lazy-loaded content

**After:**
- More specific selectors based on actual YC page structure
- Pattern-based extraction (regex for team size, location)
- Scrolls page to trigger lazy-loaded content
- Better waiting strategies for dynamic content

**Key Improvements:**
- Scrolls to bottom of page to load lazy content
- Waits longer for React/SPA content to load
- Uses text pattern matching as fallback
- Extracts job locations from listings

### 4. **Enhanced Data Storage**

**Before:**
- Only stored basic founder info (names, LinkedIn)
- Job descriptions without locations

**After:**
- Stores founder descriptions in `founder_backgrounds` column
- Stores job locations with job titles
- Better formatting of hiring roles (includes location)

**Data Format:**
- `founder_backgrounds`: Multi-line string with "Name: Description" format
- `hiring_roles`: Includes location in format "Title (Location): Description"

## Technical Details

### Founder Extraction Algorithm

1. **Find Founders Section:**
   ```typescript
   // Look for heading containing "Founders" or "Active Founders"
   const foundersSection = Array.from(document.querySelectorAll('h2, h3, section, div'))
     .find(el => el.textContent?.toLowerCase().includes('founders'));
   ```

2. **Identify Founder Cards:**
   ```typescript
   // Find cards with repeated name patterns (founders often have name displayed twice)
   const nameMatch = text.match(/\b([A-Z][a-z]+ [A-Z][a-z]+)\b/);
   const nameCount = (text.match(new RegExp(fullName, 'g')) || []).length;
   if (nameCount >= 2) { /* It's a founder card */ }
   ```

3. **Extract Description:**
   ```typescript
   // Look for paragraphs with bio keywords
   if (pText.includes('Prior to') || pText.includes('studied') || ...) {
     description = pText;
   }
   ```

### Jobs Page Detection

```typescript
// Check for jobs page link
const jobsPageUrl = await page.evaluate(() => {
  const jobsLink = Array.from(document.querySelectorAll('a'))
    .find(link => {
      const href = link.href;
      return href.includes('/jobs') || link.textContent?.includes('jobs');
    });
  return jobsLink?.href || null;
});
```

## Testing

A comprehensive test script has been created: `test_scrape_yc_companies.ts`

### Running Tests

```bash
# Test with default URL (The Interface)
npm run test:scrape-yc

# Test with custom URL
npm run test:scrape-yc -- --url=https://www.ycombinator.com/companies/your-company
```

### Test Coverage

The test script validates:
- ✅ Founder extraction (names, LinkedIn, descriptions)
- ✅ Website extraction
- ✅ Team size extraction
- ✅ Job extraction (titles, locations, descriptions)
- ✅ Location extraction
- ✅ Summary/tagline extraction
- ✅ Jobs page scraping

### Test Output

The test script provides:
- Detailed extraction results
- Validation scores
- Error reporting
- Summary statistics

## Usage

### Basic Scraping

```bash
# Scrape all companies from CSV files
npm run scrape:yc

# Scrape specific batch
npm run scrape:yc -- --batch=S25
```

### What Gets Extracted

For each company:
- **Founders**: Names, LinkedIn URLs, descriptions/bios
- **Website**: Company website URL
- **Team Size**: Number of employees
- **Jobs**: Titles, descriptions, locations (from main page + jobs page)
- **Location**: Company location
- **Summary**: One-line company description

## Database Schema

The scraper stores data in the `startups` table with these fields:

- `founder_names`: Comma-separated founder names
- `founder_linkedin`: Comma-separated LinkedIn URLs
- `founder_first_name`: Primary founder first name
- `founder_last_name`: Primary founder last name
- `founder_backgrounds`: Multi-line founder descriptions (NEW)
- `job_openings`: Comma-separated job titles
- `hiring_roles`: Detailed job info with locations (ENHANCED)
- `website`: Company website
- `team_size`: Team size number
- `location`: Company location
- `description`: Company description

## Known Limitations

1. **Dynamic Content**: Some YC pages use heavy React/SPA frameworks that may require longer wait times
2. **Rate Limiting**: YC may rate limit if scraping too aggressively (2 second delay between requests)
3. **Page Structure Changes**: If YC changes their HTML structure, selectors may need updates
4. **Founder Descriptions**: Not all companies have detailed founder bios on their YC page

## Future Improvements

Potential enhancements:
1. **Web Search Integration**: Use `web_search_agent.ts` to fill gaps when scraping fails
2. **LinkedIn Scraping**: Follow LinkedIn links to extract more founder details
3. **Company Website Scraping**: Scrape company's own website for additional info
4. **Caching**: Cache page data to avoid re-scraping
5. **Parallel Processing**: Scrape multiple companies in parallel (with rate limiting)

## Files Modified

- `yc_companies/scrape_yc_companies.ts` - Main scraper (enhanced)
- `yc_companies/test_scrape_yc_companies.ts` - Test script (new)
- `package.json` - Added test script command

## References

- YC Company Page Structure: https://www.ycombinator.com/companies/the-interface
- YC Jobs Page Structure: https://www.ycombinator.com/companies/the-interface/jobs

