# Enrichment Field Analysis: Database vs Current Extraction

## Summary
This document compares all database columns in the `startups` table against what the enrichment agent currently extracts.

---

## ✅ Currently Extracted Fields

| Database Column | Extracted? | Notes |
|----------------|------------|-------|
| `founder_names` | ✅ Yes | Comma-separated founder names |
| `founder_linkedin` | ✅ Yes | LinkedIn profile URLs |
| `website` | ✅ Yes | Company website domain |
| `location` | ✅ Yes | Company headquarters location |
| `industry` | ✅ Yes | Primary industry category |
| `funding_stage` | ✅ Yes | Maps to `round_type` column |
| `job_openings` | ✅ Yes | Comma-separated job titles (from `hiring_roles`) |
| `tech_stack` | ✅ Yes | Technology stack |
| `target_customer` | ✅ Yes | Target customer segment |
| `market_vertical` | ✅ Yes | Specific market vertical |
| `team_size` | ✅ Yes | Team size range |
| `founder_backgrounds` | ✅ Yes | Founder experience/backgrounds |
| `website_keywords` | ✅ Yes | Keywords from website |
| `keywords` | ✅ Yes | Generated from industry + target_customer |

---

## ❌ Missing Fields (Not Extracted)

| Database Column | Status | Should Extract? | Notes |
|----------------|--------|-----------------|-------|
| `date` | ❌ Missing | ✅ **YES** | Funding date (e.g., "2024-01-15", "Q1 2024") |
| `company_logo` | ❌ Missing | ⚠️ Maybe | Company logo URL (mentioned in EnrichedData interface but not extracted) |
| `yc_link` | ❌ Missing | ⚠️ Maybe | YC company page link (mentioned in EnrichedData interface but not extracted) |

---

## 🔄 Handled Separately (Not by Enricher)

| Database Column | Handled By | Notes |
|----------------|------------|-------|
| `founder_emails` | `email_pattern_matcher.ts` + `founder_email_discovery.ts` | Pattern matching approach |
| `description` | TechCrunch scraper | Article description |
| `funding_amount` | TechCrunch scraper | Usually comes from article |
| `name` | TechCrunch scraper | Company name (primary key) |
| `data_source` | TechCrunch scraper | Source tracking |
| `techcrunch_article_link` | TechCrunch scraper | Article URL |
| `techcrunch_article_content` | TechCrunch scraper | Full article content |

---

## 🔧 System-Managed Fields (Auto-set)

| Database Column | Managed By | Notes |
|----------------|------------|-------|
| `needs_enrichment` | Enrichment process | Auto-updated based on enrichment status |
| `enrichment_status` | Enrichment process | 'pending', 'in_progress', 'completed', 'failed' |
| `enrichment_quality_score` | Quality system | 0.0-1.0 score |
| `enrichment_quality_status` | Quality system | 'excellent', 'good', 'fair', 'poor' |
| `pinecone_id` | Embedding system | Vector database ID |
| `created_at` | Database | Auto timestamp |
| `updated_at` | Database | Auto timestamp (trigger) |

---

## 🚨 Critical Missing Fields

### 1. `date` (Funding Date)
- **Current Status**: ❌ NOT extracted
- **Importance**: HIGH - Funding date is important for filtering/relevance
- **Can be extracted from**: Web search results, TechCrunch articles, Crunchbase
- **Format**: TEXT (e.g., "2024-01-15", "Q1 2024", "January 2024", "2024")

### 2. `company_logo` (Optional)
- **Current Status**: ❌ Mentioned in interface but NOT extracted
- **Importance**: MEDIUM - Nice to have for UI display
- **Can be extracted from**: Company website, YC page, social media

### 3. `yc_link` (Optional)
- **Current Status**: ❌ Mentioned in interface but NOT extracted
- **Importance**: LOW - Only relevant for YC companies
- **Can be extracted from**: Web search (e.g., "YC company page")

---

## 📋 Recommendations

### Priority 1: Add Funding Date Extraction
1. Add `funding_date` or `date_raised` to LLM extraction prompt
2. Extract from search results (look for patterns like "raised in January 2024", "funding round in Q1 2024")
3. Map to `date` column in database
4. Format: Keep as text, flexible format (YYYY-MM-DD preferred if possible)

### Priority 2: Extract Company Logo (if needed)
- Only if UI needs logo display
- Extract from company website or YC page

### Priority 3: Extract YC Link (if needed)
- Only for YC companies
- Extract YC company page URL

---

## Implementation Steps

1. ✅ Update `extractAllEnrichmentData` to extract `funding_date`
2. ✅ Add `funding_date` to `EnrichmentData` interface
3. ✅ Map `funding_date` to `date` column in database
4. ✅ Update LLM prompt to extract funding dates
5. ⚠️ Consider adding company_logo and yc_link if needed


