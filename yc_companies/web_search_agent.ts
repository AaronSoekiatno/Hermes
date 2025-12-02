/**
 * Web Search Agent Implementation
 * 
 * This module provides web search functionality using:
 * - Gemini Grounding (paid tier only) - Google Search integrated with Gemini
 * - DuckDuckGo (free, no API key needed) - Primary search method
 * 
 * Includes LLM-based extraction (Phase 1 of Agentic Workflow):
 * - Uses Gemini AI for intelligent data extraction
 * - Falls back to regex patterns if LLM unavailable
 * - Provides confidence scores for extracted data
 * 
 * Anti-Hallucination Features:
 * - Strict prompts that only extract EXPLICITLY stated information
 * - Validation functions that filter out placeholders and generic values
 * - Confidence thresholds (0.7 minimum) to reject uncertain extractions
 * - Field-specific validation to ensure data quality matches schema requirements
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface ExtractionConfidence {
  founder_names?: number;
  founder_linkedin?: number;
  website?: number;
  job_openings?: number;
  tech_stack?: number;
  [key: string]: number | undefined;
}

// Global flag to track if Gemini quota is exceeded
let geminiQuotaExceeded = false;

/**
 * Check if Gemini quota is exceeded
 */
export function isGeminiQuotaExceeded(): boolean {
  return geminiQuotaExceeded;
}

/**
 * Check if an error indicates quota exceeded
 */
function isQuotaExceededError(error: any): boolean {
  if (!error) return false;
  const errorStr = error.toString() + JSON.stringify(error);
  return (
    error.status === 429 ||
    errorStr.includes('429') ||
    errorStr.includes('quota') ||
    errorStr.includes('Quota exceeded') ||
    errorStr.includes('exceeded your current quota')
  );
}

/**
 * Get Gemini client (lazy initialization)
 * Returns null if quota exceeded or API key not set
 */
function getGeminiClient() {
  // Skip if quota exceeded
  if (geminiQuotaExceeded) {
    return null;
  }
  
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenerativeAI(apiKey);
}

/**
 * Clean JSON response from LLM (removes markdown code blocks if present)
 */
function cleanJsonResponse(text: string): string {
  // Remove markdown code blocks
  let cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  
  // Find JSON object in response
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }
  
  return cleaned;
}

/**
 * Search using Google Custom Search API
 * @deprecated Not used - removed in favor of DuckDuckGo and Gemini Grounding
 */
async function searchWithGoogle(query: string): Promise<SearchResult[]> {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;
  
  if (!apiKey || !searchEngineId) {
    throw new Error('Google Search API credentials not found. Set GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID');
  }
  
  const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (!data.items) {
      return [];
    }
    
    return data.items.map((item: any) => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet,
    }));
  } catch (error) {
    console.error('Google Search API error:', error);
    return [];
  }
}

/**
 * Search using SerpAPI
 * @deprecated Not used - removed in favor of DuckDuckGo and Gemini Grounding
 */
async function searchWithSerpAPI(query: string): Promise<SearchResult[]> {
  const apiKey = process.env.SERPAPI_KEY;
  
  if (!apiKey) {
    throw new Error('SerpAPI key not found. Set SERPAPI_KEY');
  }
  
  const url = `https://serpapi.com/search.json?api_key=${apiKey}&q=${encodeURIComponent(query)}`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (!data.organic_results) {
      return [];
    }
    
    return data.organic_results.map((result: any) => ({
      title: result.title,
      url: result.link,
      snippet: result.snippet,
    }));
  } catch (error) {
    console.error('SerpAPI error:', error);
    return [];
  }
}

/**
 * Search using Bing Search API
 * @deprecated Not used - removed in favor of DuckDuckGo and Gemini Grounding
 */
async function searchWithBing(query: string): Promise<SearchResult[]> {
  const apiKey = process.env.BING_SEARCH_API_KEY;
  
  if (!apiKey) {
    throw new Error('Bing Search API key not found. Set BING_SEARCH_API_KEY');
  }
  
  const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'Ocp-Apim-Subscription-Key': apiKey,
      },
    });
    
    const data = await response.json();
    
    if (!data.webPages || !data.webPages.value) {
      return [];
    }
    
    return data.webPages.value.map((result: any) => ({
      title: result.name,
      url: result.url,
      snippet: result.snippet,
    }));
  } catch (error) {
    console.error('Bing Search API error:', error);
    return [];
  }
}

/**
 * Search using DuckDuckGo (free, no API key needed)
 * Uses DuckDuckGo's instant answer API and web search
 */
async function searchWithDuckDuckGo(query: string): Promise<SearchResult[]> {
  try {
    // Use DuckDuckGo's API endpoint (more reliable than HTML scraping)
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    if (!response.ok) {
      throw new Error(`DuckDuckGo API failed: ${response.status}`);
    }
    
    const data = await response.json();
    const results: SearchResult[] = [];
    
    // Add instant answer if available
    if (data.AbstractText) {
      results.push({
        title: data.Heading || query,
        url: data.AbstractURL || '',
        snippet: data.AbstractText,
      });
    }
    
    // Add related topics
    if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
      for (const topic of data.RelatedTopics.slice(0, 5)) {
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Text.split(' - ')[0] || topic.Text,
            url: topic.FirstURL,
            snippet: topic.Text,
          });
        }
      }
    }
    
    // If we have results, return them
    if (results.length > 0) {
      return results.slice(0, 10);
    }
    
    // Fallback: Use HTML search with better parsing
    return await searchWithDuckDuckGoHTML(query);
  } catch (error) {
    console.warn('DuckDuckGo API search failed, trying HTML fallback...', error);
    // Fallback to HTML search
    return await searchWithDuckDuckGoHTML(query);
  }
}

/**
 * Fallback: Search using DuckDuckGo HTML (more reliable parsing)
 */
async function searchWithDuckDuckGoHTML(query: string): Promise<SearchResult[]> {
  try {
    const { default: puppeteer } = await import('puppeteer');
    
    // Launch headless browser with timeout
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      timeout: 30000,
    });
    
    try {
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      // Navigate to DuckDuckGo with shorter timeout
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      
      // Wait a bit for results to load
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Extract search results with multiple selector strategies
      const results = await page.evaluate(() => {
        const searchResults: Array<{ title: string; url: string; snippet: string }> = [];
        
        // Try multiple selectors for DuckDuckGo's varying HTML structure
        const selectors = [
          '.result .result__a',
          '.web-result .result__a',
          '.result a.result__a',
          'a.result__a',
          '.result__title',
          '.result-title a',
        ];
        
        let titleElements: NodeListOf<Element> | null = null;
        for (const selector of selectors) {
          titleElements = document.querySelectorAll(selector);
          if (titleElements.length > 0) break;
        }
        
        if (!titleElements || titleElements.length === 0) {
          return [];
        }
        
        titleElements.forEach((titleEl, index) => {
          if (index >= 10) return; // Limit to 10 results
          
          const title = titleEl.textContent?.trim() || '';
          const url = (titleEl as HTMLAnchorElement).href || '';
          
          // Find snippet - look in parent or sibling elements
          let snippet = '';
          const parent = titleEl.closest('.result, .web-result');
          if (parent) {
            const snippetEl = parent.querySelector('.result__snippet, .result-snippet, .snippet');
            snippet = snippetEl?.textContent?.trim() || '';
          }
          
          if (title && url && url.startsWith('http')) {
            searchResults.push({ title, url, snippet });
          }
        });
        
        return searchResults;
      });
      
      return results.length > 0 ? results : [];
    } finally {
      await browser.close();
    }
  } catch (error) {
    console.warn('DuckDuckGo HTML search error:', error instanceof Error ? error.message : String(error));
    // Return empty results rather than throwing
    return [];
  }
}

/**
 * Search using Gemini Grounding with Google Search
 * Uses Gemini API with Google Search integration - no separate search API needed!
 * Requires: GEMINI_API_KEY (which you already have for extraction)
 */
async function searchWithGeminiGrounding(query: string): Promise<SearchResult[]> {
  const genAI = getGeminiClient();
  if (!genAI) {
    throw new Error('GEMINI_API_KEY not set');
  }

  // Rate limit before calling Gemini API
  await rateLimitGemini();

  try {
    // Use configurable model (defaults to gemini-2.5-pro)
    // For paid tier, can use gemini-2.0-flash-exp or gemini-1.5-pro
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-pro';
    const model = genAI.getGenerativeModel({ 
      model: modelName,
      tools: [{
        googleSearchRetrieval: {} // Enable Google Search grounding (paid tier feature)
      }]
    });

    const prompt = `Search the web for: "${query}"

Return a JSON array of search results in this exact format:
[
  {
    "title": "Page title",
    "url": "https://example.com/page",
    "snippet": "Brief description or excerpt"
  }
]

Include the top 10 most relevant results.`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    
    // Try to extract JSON from response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.map((item: any) => ({
        title: item.title || '',
        url: item.url || '',
        snippet: item.snippet || '',
      }));
    }

    // If JSON parsing fails, try to extract from text
    // Gemini might return structured text instead of JSON
    return [];
  } catch (error) {
    console.warn('Gemini Grounding search failed:', error);
    throw error;
  }
}

// Rate limiter for Gemini API
// Free tier: 2 RPM = 30s between calls
// Paid tier: 15 RPM = 4s between calls (or higher limits)
let lastGeminiCall = 0;

function getGeminiRateLimit(): number {
  // Check if user has set a custom rate limit
  const customLimit = process.env.GEMINI_RATE_LIMIT_MS;
  if (customLimit) {
    return parseInt(customLimit, 10);
  }
  
  // Check if user explicitly wants paid tier behavior
  const isPaidTier = process.env.GEMINI_PAID_TIER === 'true';
  if (isPaidTier) {
    // Paid tier: 15 RPM = 4 seconds between calls (conservative)
    return 4000;
  }
  
  // Default: Free tier (2 RPM = 30 seconds)
  return 30000;
}

export async function rateLimitGemini(): Promise<void> {
  const minInterval = getGeminiRateLimit();
  const now = Date.now();
  const timeSinceLastCall = now - lastGeminiCall;
  
  if (timeSinceLastCall < minInterval) {
    const waitTime = minInterval - timeSinceLastCall;
    if (waitTime > 1000) { // Only log if waiting more than 1 second
      console.log(`  ⏳ Rate limiting: waiting ${Math.ceil(waitTime / 1000)}s before next Gemini API call...`);
    }
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  lastGeminiCall = Date.now();
}

/**
 * Main search function - tries different APIs in order
 * Priority: Gemini Grounding (if paid tier) > DuckDuckGo > Google > SerpAPI > Bing
 */
export async function searchWeb(query: string): Promise<SearchResult[]> {
  // Try Gemini Grounding first if on paid tier (requires GEMINI_PAID_TIER=true)
  // This uses Google Search integrated with Gemini - no separate search API needed!
  const isPaidTier = process.env.GEMINI_PAID_TIER === 'true';
  if (process.env.GEMINI_API_KEY && isPaidTier) {
    try {
      const results = await searchWithGeminiGrounding(query);
      if (results.length > 0) {
        return results;
      }
    } catch (error: any) {
      // If it's a 400 error about google_search_retrieval, fall back
      if (error?.status === 400) {
        console.warn('Gemini Grounding not available (may require paid tier), using alternatives...');
      } else {
        console.warn('Gemini Grounding search failed, trying alternatives...', error);
      }
    }
  }
  
  // Use DuckDuckGo (free, no API key needed) - with retry logic
  let lastError: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const results = await searchWithDuckDuckGo(query);
      if (results.length > 0) {
        return results;
      }
      // If we got empty results, wait a bit and retry (might be rate limited)
      if (attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
      }
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        console.warn(`DuckDuckGo search attempt ${attempt + 1} failed, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
      }
    }
  }
  
  // If DuckDuckGo failed after retries, log but don't throw yet
  if (lastError) {
    console.warn('DuckDuckGo search failed after retries:', lastError instanceof Error ? lastError.message : String(lastError));
  }
  
  // If we get here, DuckDuckGo failed after all retries
  // Return empty results instead of throwing - let the agent continue with other queries
  console.warn('⚠️  DuckDuckGo search failed for this query. It may be rate-limited or the query may be too specific.');
  console.warn('   The agent will continue with other search queries.');
  return [];
}

// ============================================================================
// LLM-BASED EXTRACTION (Agentic Phase 1)
// ============================================================================

/**
 * Extract founder information using LLM (Gemini)
 * Returns data with confidence scores
 */
async function extractFounderInfoWithLLM(
  results: SearchResult[],
  companyName: string
): Promise<{
  founder_names: string;
  founder_linkedin: string;
  confidence: ExtractionConfidence;
}> {
  const genAI = getGeminiClient();
  if (!genAI) {
    throw new Error('GEMINI_API_KEY not set');
  }

  const context = results
    .slice(0, 10) // Use top 10 results
    .map((r, idx) => `[${idx + 1}] ${r.title}\n${r.snippet}\nURL: ${r.url}`)
    .join('\n\n');

  const prompt = `You are a strict data extraction agent. Extract ONLY founder information that is EXPLICITLY stated in the search results below about "${companyName}".

CRITICAL RULES:
1. ONLY extract information that is DIRECTLY mentioned in the search results
2. DO NOT infer, guess, or make up any information
3. DO NOT use common knowledge or assumptions
4. If information is not clearly stated, return an empty string
5. Set confidence to 0.0 if you're not certain the information is in the results

Search Results:
${context}

Extract the following information and return ONLY valid JSON (no markdown, no explanation):
{
  "founder_names": "Comma-separated full names of founders/CEOs EXPLICITLY mentioned (first + last name), or empty string",
  "founder_linkedin": "LinkedIn profile URL EXPLICITLY mentioned (e.g., linkedin.com/in/username), or empty string",
  "confidence": {
    "founder_names": 0.0-1.0,
    "founder_linkedin": 0.0-1.0
  }
}

STRICT EXTRACTION RULES:
- For founder_names: Only extract if full names (first + last) are EXPLICITLY stated. Do NOT extract:
  * Generic names like "Team", "Founder", "CEO", "Co-founder"
  * Single first names only (must have last name)
  * Placeholder values like "N/A", "TBD", "Unknown"
- For founder_linkedin: Only extract if a LinkedIn URL is EXPLICITLY mentioned in the results
- Cross-reference multiple results - if information conflicts, use the most common or set confidence lower
- Return empty strings if information is not found or uncertain

CONFIDENCE SCORING:
- Set confidence to 0.9+ only if information is EXPLICITLY stated multiple times
- Set confidence to 0.7-0.8 if information is clearly stated once
- Set confidence to 0.0-0.6 if you're uncertain or inferring
- Return empty string if confidence < 0.7`;

  try {
    // Rate limit before calling Gemini API
    await rateLimitGemini();
    
    // Use Flash model for cost-effectiveness (22.5x cheaper than Pro)
    // Try gemini-2.0-flash first, fallback to 2.5-flash, then 2.5-pro
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const model = genAI.getGenerativeModel({ 
      model: modelName
    });
    
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const cleanedResponse = cleanJsonResponse(responseText);
    const parsed = JSON.parse(cleanedResponse);

    // Validate extracted data
    const confidence = parsed.confidence || {};
    const minConfidence = 0.7;
    
    const founder_names = validateFounderNames(
      parsed.founder_names || '',
      confidence.founder_names || 0,
      minConfidence
    );
    
    const founder_linkedin = validateLinkedIn(
      parsed.founder_linkedin || '',
      confidence.founder_linkedin || 0,
      minConfidence
    );

    return {
      founder_names,
      founder_linkedin,
      confidence,
    };
  } catch (error) {
    // Check if quota exceeded
    if (isQuotaExceededError(error)) {
      geminiQuotaExceeded = true;
      console.warn('⚠️  Gemini quota exceeded. Disabling LLM extraction for this session. Using regex-only extraction.');
    }
    console.warn('LLM extraction failed, falling back to regex:', error instanceof Error ? error.message : String(error));
    throw error; // Will trigger fallback
  }
}

/**
 * Validation functions to prevent hallucinations and ensure data quality
 */

/**
 * Check if a value is a placeholder or generic value
 */
function isPlaceholderValue(value: string, field: string): boolean {
  const lower = value.toLowerCase().trim();
  const placeholders = [
    'team', 'founder', 'ceo', 'n/a', 'na', 'tbd', 'to be determined',
    'unknown', 'not specified', 'default', 'placeholder', 'example',
    'test', 'sample', 'lorem ipsum'
  ];
  
  if (placeholders.some(p => lower === p || lower.includes(p))) {
    return true;
  }
  
  // Field-specific placeholders
  if (field === 'founder_names' && (lower === 'team' || lower === 'founder' || lower.split(' ').length < 2)) {
    return true;
  }
  
  if (field === 'website' && (lower === 'website.com' || lower === 'example.com' || !lower.includes('.'))) {
    return true;
  }
  
  return false;
}

/**
 * Validate founder names - reject placeholders and ensure full names
 */
function validateFounderNames(value: string, confidence: number, minConfidence: number): string {
  if (confidence < minConfidence) return '';
  if (isPlaceholderValue(value, 'founder_names')) return '';
  
  // Must have at least first and last name (2+ words)
  const names = value.split(',').map(n => n.trim()).filter(n => n.length > 0);
  const validNames = names.filter(name => {
    const parts = name.split(/\s+/);
    return parts.length >= 2 && !isPlaceholderValue(name, 'founder_names');
  });
  
  return validNames.length > 0 ? validNames.join(', ') : '';
}

/**
 * Validate LinkedIn URL
 */
function validateLinkedIn(value: string, confidence: number, minConfidence: number): string {
  if (confidence < minConfidence) return '';
  if (!value.toLowerCase().includes('linkedin.com')) return '';
  
  // Clean up the URL
  let cleaned = value.trim();
  if (!cleaned.startsWith('http')) {
    cleaned = 'https://' + cleaned;
  }
  
  return cleaned;
}

/**
 * Validate website domain
 */
function validateWebsite(value: string, confidence: number, minConfidence: number): string {
  if (confidence < minConfidence) return '';
  if (isPlaceholderValue(value, 'website')) return '';
  
  try {
    // Remove protocol if present
    let domain = value.replace(/^https?:\/\//, '').replace(/^www\./, '');
    // Extract domain (remove path)
    domain = domain.split('/')[0].toLowerCase();
    
    // Filter out excluded domains
    if (isExcludedDomain(domain)) {
      return '';
    }
    
    // Must be a valid domain format
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(domain)) {
      return '';
    }
    
    return domain;
  } catch (error) {
    return '';
  }
}

/**
 * Validate location
 */
function validateLocation(value: string, confidence: number, minConfidence: number): string {
  if (confidence < minConfidence) return '';
  if (isPlaceholderValue(value, 'location')) return '';
  
  // Must contain at least a city name (2+ characters)
  if (value.trim().length < 2) return '';
  
  return value.trim();
}

/**
 * Validate industry
 */
function validateIndustry(value: string, confidence: number, minConfidence: number): string {
  if (confidence < minConfidence) return '';
  if (isPlaceholderValue(value, 'industry')) return '';
  
  // Must be a reasonable industry name (2+ characters)
  if (value.trim().length < 2) return '';
  
  return value.trim();
}

/**
 * Validate funding stage
 */
function validateFundingStage(value: string, confidence: number, minConfidence: number): string {
  if (confidence < minConfidence) return '';
  if (isPlaceholderValue(value, 'funding_stage')) return '';
  
  const validStages = [
    'Pre-Seed', 'Pre-Seed', 'Seed', 'Series A', 'Series B', 'Series C',
    'Series D', 'Series E', 'Bridge', 'IPO', 'Acquired', 'Bootstrapped'
  ];
  
  const lower = value.trim();
  // Check if it matches a valid stage (case-insensitive)
  const isValid = validStages.some(stage => stage.toLowerCase() === lower.toLowerCase());
  
  return isValid ? value.trim() : '';
}

/**
 * Validate hiring roles
 */
function validateHiringRoles(value: string, confidence: number, minConfidence: number): string {
  if (confidence < minConfidence) return '';
  if (isPlaceholderValue(value, 'hiring_roles')) return '';
  
  // Must contain actual job titles (not just generic terms)
  const roles = value.split(',').map(r => r.trim()).filter(r => r.length > 0);
  const validRoles = roles.filter(role => {
    const lower = role.toLowerCase();
    // Reject generic terms
    if (['job', 'position', 'opening', 'role', 'hiring'].includes(lower)) {
      return false;
    }
    return role.length >= 3; // Must be at least 3 characters
  });
  
  return validRoles.length > 0 ? validRoles.join(', ') : '';
}

/**
 * Validate tech stack
 */
function validateTechStack(value: string, confidence: number, minConfidence: number): string {
  if (confidence < minConfidence) return '';
  if (isPlaceholderValue(value, 'tech_stack')) return '';
  
  // Must contain actual technology names
  const techs = value.split(',').map(t => t.trim()).filter(t => t.length > 0);
  const validTechs = techs.filter(tech => {
    // Reject generic terms
    const lower = tech.toLowerCase();
    if (['technology', 'tech', 'stack', 'tools'].includes(lower)) {
      return false;
    }
    return tech.length >= 2;
  });
  
  return validTechs.length > 0 ? validTechs.join(', ') : '';
}


/**
 * Validate team size
 */
function validateTeamSize(value: string, confidence: number, minConfidence: number): string {
  if (confidence < minConfidence) return '';
  if (isPlaceholderValue(value, 'team_size')) return '';
  
  // Must match expected format (e.g., "1-10", "10-50", "50-200", "200-500", "500+")
  const validFormats = [
    /^\d+-\d+$/,  // e.g., "1-10"
    /^\d+\+$/,    // e.g., "500+"
    /^\d+$/,      // e.g., "50"
  ];
  
  const trimmed = value.trim();
  const isValid = validFormats.some(regex => regex.test(trimmed));
  
  return isValid ? trimmed : '';
}

/**
 * Validate founder backgrounds
 */
function validateFounderBackgrounds(value: string, confidence: number, minConfidence: number): string {
  if (confidence < minConfidence) return '';
  if (isPlaceholderValue(value, 'founder_backgrounds')) return '';
  
  // Must contain actual company/university names
  const backgrounds = value.split(',').map(b => b.trim()).filter(b => b.length > 0);
  const validBackgrounds = backgrounds.filter(bg => {
    // Reject generic terms
    const lower = bg.toLowerCase();
    if (['company', 'university', 'school', 'previous'].includes(lower)) {
      return false;
    }
    return bg.length >= 3;
  });
  
  return validBackgrounds.length > 0 ? validBackgrounds.join(', ') : '';
}

/**
 * Validate website keywords
 */
function validateWebsiteKeywords(value: string, confidence: number, minConfidence: number): string {
  if (confidence < minConfidence) return '';
  if (isPlaceholderValue(value, 'website_keywords')) return '';

  // Must contain actual keywords (not just generic terms)
  const keywords = value.split(',').map(k => k.trim()).filter(k => k.length > 0);
  const validKeywords = keywords.filter(kw => {
    const lower = kw.toLowerCase();
    // Reject generic terms
    if (['keyword', 'tag', 'category', 'type'].includes(lower)) {
      return false;
    }
    return kw.length >= 2;
  });

  return validKeywords.length > 0 ? validKeywords.join(', ') : '';
}

/**
 * Validate funding amount
 */
function validateFundingAmount(value: string, confidence: number, minConfidence: number): string {
  if (confidence < minConfidence) return '';
  if (!value || typeof value !== 'string') return '';

  const trimmed = value.trim();

  // Must contain $ and a number with M or B suffix
  const fundingPattern = /^\$?\s*\d+(\.\d+)?\s*[MB]\b/i;
  if (!fundingPattern.test(trimmed)) return '';

  // Normalize format: "$20M" or "$1.5B"
  const match = trimmed.match(/(\d+(?:\.\d+)?)\s*([MB])/i);
  if (match) {
    return `$${match[1]}${match[2].toUpperCase()}`;
  }

  return '';
}

/**
 * Validate funding date
 */
function validateFundingDate(value: string, confidence: number, minConfidence: number): string {
  if (confidence < minConfidence) return '';
  if (!value || typeof value !== 'string') return '';

  const trimmed = value.trim();

  // Accept formats: YYYY-MM-DD, YYYY-MM, YYYY
  const datePatterns = [
    /^\d{4}-\d{2}-\d{2}$/,  // YYYY-MM-DD
    /^\d{4}-\d{2}$/,        // YYYY-MM
    /^\d{4}$/,              // YYYY
  ];

  const isValid = datePatterns.some(pattern => pattern.test(trimmed));
  if (!isValid) return '';

  // Validate year is reasonable (2000-2030)
  const year = parseInt(trimmed.substring(0, 4));
  if (year < 2000 || year > 2030) return '';

  return trimmed;
}

/**
 * Validate required skills (technical skills from job postings)
 */
function validateRequiredSkills(value: string, confidence: number, minConfidence: number): string {
  if (confidence < minConfidence) return '';
  if (!value || typeof value !== 'string') return '';

  // Must contain actual technology/skill names
  const skills = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
  const validSkills = skills.filter(skill => {
    const lower = skill.toLowerCase();

    // Reject generic/soft skills
    const genericTerms = [
      'technology', 'tech', 'stack', 'tools', 'skills',
      'teamwork', 'communication', 'leadership', 'problem solving',
      'ability', 'experience', 'knowledge', 'strong', 'excellent'
    ];

    if (genericTerms.some(term => lower === term || lower.includes(term))) {
      return false;
    }

    // Must be at least 2 characters
    return skill.length >= 2;
  });

  return validSkills.length > 0 ? validSkills.join(', ') : '';
}

/**
 * TARGETED EXTRACTION FUNCTIONS - Multi-Query Approach
 * Instead of one big query, use specialized searches for better accuracy
 */

/**
 * Extract company overview data (website, industry, location, description)
 */
async function extractCompanyOverviewWithLLM(
  results: SearchResult[],
  companyName: string
): Promise<{
  website: string;
  industry: string;
  location: string;
  website_keywords: string;
  confidence: ExtractionConfidence;
}> {
  const genAI = getGeminiClient();
  if (!genAI) {
    throw new Error('GEMINI_API_KEY not set');
  }

  const context = results
    .slice(0, 10)
    .map((r, idx) => `[${idx + 1}] ${r.title}\n${r.snippet}\nURL: ${r.url}`)
    .join('\n\n');

  const prompt = `You are a strict data extraction agent. Extract ONLY company overview information that is EXPLICITLY stated in the search results about "${companyName}".

CRITICAL RULES:
1. ONLY extract information DIRECTLY mentioned in the search results
2. DO NOT infer, guess, or use common knowledge
3. If not clearly stated, return empty string
4. Set confidence to 0.0 if uncertain

Search Results:
${context}

Return ONLY valid JSON (no markdown):
{
  "website": "Official domain EXPLICITLY mentioned (e.g., 'example.com'), or empty",
  "industry": "Primary industry EXPLICITLY stated (e.g., 'Fintech', 'Healthcare'), or empty",
  "location": "City, State/Country EXPLICITLY mentioned (e.g., 'San Francisco, CA'), or empty",
  "website_keywords": "Keywords EXPLICITLY used to describe company, or empty",
  "confidence": {
    "website": 0.0-1.0,
    "industry": 0.0-1.0,
    "location": 0.0-1.0,
    "website_keywords": 0.0-1.0
  }
}

VALIDATION:
- website: domain only, not search engines/social media/news sites
- location: must include city name
- Confidence 0.9+ if stated multiple times, 0.7-0.8 if stated once, 0.0-0.6 if uncertain`;

  try {
    await rateLimitGemini();
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const model = genAI.getGenerativeModel({ model: modelName });

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const cleanedResponse = cleanJsonResponse(responseText);
    const parsed = JSON.parse(cleanedResponse);

    const confidence = parsed.confidence || {};
    const minConfidence = 0.7;

    return {
      website: validateWebsite(parsed.website || '', confidence.website || 0, minConfidence),
      industry: validateIndustry(parsed.industry || '', confidence.industry || 0, minConfidence),
      location: validateLocation(parsed.location || '', confidence.location || 0, minConfidence),
      website_keywords: validateWebsiteKeywords(parsed.website_keywords || '', confidence.website_keywords || 0, minConfidence),
      confidence,
    };
  } catch (error) {
    if (isQuotaExceededError(error)) {
      geminiQuotaExceeded = true;
    }
    throw error;
  }
}

/**
 * Extract funding data (amount, round type, date)
 */
async function extractFundingDataWithLLM(
  results: SearchResult[],
  companyName: string
): Promise<{
  funding_amount: string;
  funding_stage: string;
  funding_date: string;
  confidence: ExtractionConfidence;
}> {
  const genAI = getGeminiClient();
  if (!genAI) {
    throw new Error('GEMINI_API_KEY not set');
  }

  const context = results
    .slice(0, 10)
    .map((r, idx) => `[${idx + 1}] ${r.title}\n${r.snippet}\nURL: ${r.url}`)
    .join('\n\n');

  const prompt = `You are a strict data extraction agent. Extract ONLY funding information that is EXPLICITLY stated in the search results about "${companyName}".

CRITICAL RULES:
1. ONLY extract information DIRECTLY mentioned in the search results
2. DO NOT infer or guess
3. If not clearly stated, return empty string

Search Results:
${context}

Return ONLY valid JSON (no markdown):
{
  "funding_amount": "Amount EXPLICITLY mentioned (e.g., '$5M', '$20M', '$100M'), or empty",
  "funding_stage": "Stage EXPLICITLY mentioned (Pre-Seed, Seed, Series A/B/C/D, Bridge, IPO), or empty",
  "funding_date": "Date EXPLICITLY mentioned (YYYY-MM-DD or YYYY-MM or YYYY), or empty",
  "confidence": {
    "funding_amount": 0.0-1.0,
    "funding_stage": 0.0-1.0,
    "funding_date": 0.0-1.0
  }
}

VALIDATION:
- funding_amount: must include $ and amount (M for millions, B for billions)
- funding_stage: must match standard stages (not "Seed" if article says "Series A")
- funding_date: must be a real date mentioned in results
- Confidence 0.9+ if multiple mentions, 0.7-0.8 if once, <0.7 if uncertain`;

  try {
    await rateLimitGemini();
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const model = genAI.getGenerativeModel({ model: modelName });

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const cleanedResponse = cleanJsonResponse(responseText);
    const parsed = JSON.parse(cleanedResponse);

    const confidence = parsed.confidence || {};
    const minConfidence = 0.7;

    return {
      funding_amount: validateFundingAmount(parsed.funding_amount || '', confidence.funding_amount || 0, minConfidence),
      funding_stage: validateFundingStage(parsed.funding_stage || '', confidence.funding_stage || 0, minConfidence),
      funding_date: validateFundingDate(parsed.funding_date || '', confidence.funding_date || 0, minConfidence),
      confidence,
    };
  } catch (error) {
    if (isQuotaExceededError(error)) {
      geminiQuotaExceeded = true;
    }
    throw error;
  }
}

/**
 * Extract team data (founders, backgrounds, team size)
 */
async function extractTeamDataWithLLM(
  results: SearchResult[],
  companyName: string
): Promise<{
  founder_names: string;
  founder_linkedin: string;
  founder_backgrounds: string;
  team_size: string;
  confidence: ExtractionConfidence;
}> {
  const genAI = getGeminiClient();
  if (!genAI) {
    throw new Error('GEMINI_API_KEY not set');
  }

  const context = results
    .slice(0, 10)
    .map((r, idx) => `[${idx + 1}] ${r.title}\n${r.snippet}\nURL: ${r.url}`)
    .join('\n\n');

  const prompt = `You are a strict data extraction agent. Extract ONLY team information that is EXPLICITLY stated in the search results about "${companyName}".

CRITICAL RULES:
1. ONLY extract information DIRECTLY mentioned
2. DO NOT infer or guess
3. Full names only (first + last)

Search Results:
${context}

Return ONLY valid JSON (no markdown):
{
  "founder_names": "Comma-separated FULL names EXPLICITLY mentioned (first + last), or empty",
  "founder_linkedin": "LinkedIn URL EXPLICITLY mentioned, or empty",
  "founder_backgrounds": "Previous companies/universities EXPLICITLY mentioned, or empty",
  "team_size": "Team size EXPLICITLY mentioned with numbers (e.g., '10-50', '200+'), or empty",
  "confidence": {
    "founder_names": 0.0-1.0,
    "founder_linkedin": 0.0-1.0,
    "founder_backgrounds": 0.0-1.0,
    "team_size": 0.0-1.0
  }
}

VALIDATION:
- founder_names: Must have first AND last name, no generic titles like "CEO", "Team"
- founder_linkedin: Must be valid LinkedIn URL
- founder_backgrounds: Must be specific company/university names, not generic terms
- team_size: Must match format like '1-10', '10-50', '500+'`;

  try {
    await rateLimitGemini();
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const model = genAI.getGenerativeModel({ model: modelName });

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const cleanedResponse = cleanJsonResponse(responseText);
    const parsed = JSON.parse(cleanedResponse);

    const confidence = parsed.confidence || {};
    const minConfidence = 0.7;

    return {
      founder_names: validateFounderNames(parsed.founder_names || '', confidence.founder_names || 0, minConfidence),
      founder_linkedin: validateLinkedIn(parsed.founder_linkedin || '', confidence.founder_linkedin || 0, minConfidence),
      founder_backgrounds: validateFounderBackgrounds(parsed.founder_backgrounds || '', confidence.founder_backgrounds || 0, minConfidence),
      team_size: validateTeamSize(parsed.team_size || '', confidence.team_size || 0, minConfidence),
      confidence,
    };
  } catch (error) {
    if (isQuotaExceededError(error)) {
      geminiQuotaExceeded = true;
    }
    throw error;
  }
}

/**
 * Extract job openings and REQUIRED SKILLS from job descriptions
 * This is much better than guessing tech stack - it shows what skills they actually need
 */
async function extractJobsAndSkillsWithLLM(
  results: SearchResult[],
  companyName: string
): Promise<{
  hiring_roles: string;
  required_skills: string;
  confidence: ExtractionConfidence;
}> {
  const genAI = getGeminiClient();
  if (!genAI) {
    throw new Error('GEMINI_API_KEY not set');
  }

  const context = results
    .slice(0, 10)
    .map((r, idx) => `[${idx + 1}] ${r.title}\n${r.snippet}\nURL: ${r.url}`)
    .join('\n\n');

  const prompt = `You are a strict data extraction agent. Extract ONLY job and skill information that is EXPLICITLY stated in job postings for "${companyName}".

CRITICAL RULES:
1. ONLY extract from actual job postings/career pages
2. DO NOT guess technologies based on industry
3. Extract skills/requirements that are EXPLICITLY listed

Search Results:
${context}

Return ONLY valid JSON (no markdown):
{
  "hiring_roles": "Job titles EXPLICITLY mentioned in postings (comma-separated), or empty",
  "required_skills": "Skills/technologies EXPLICITLY required in job descriptions (e.g., 'Python, React, AWS, PostgreSQL'), or empty",
  "confidence": {
    "hiring_roles": 0.0-1.0,
    "required_skills": 0.0-1.0
  }
}

VALIDATION:
- hiring_roles: Must be specific job titles (e.g., 'Software Engineer', 'Product Manager'), not generic terms
- required_skills: Must be EXPLICITLY mentioned in job requirements (languages, frameworks, tools, platforms)
- Focus on technical skills: programming languages, frameworks, databases, cloud platforms, tools
- DO NOT include soft skills like 'teamwork', 'communication'
- Confidence 0.9+ if from multiple job postings, 0.7-0.8 if from one posting`;

  try {
    await rateLimitGemini();
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const model = genAI.getGenerativeModel({ model: modelName });

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const cleanedResponse = cleanJsonResponse(responseText);
    const parsed = JSON.parse(cleanedResponse);

    const confidence = parsed.confidence || {};
    const minConfidence = 0.7;

    return {
      hiring_roles: validateHiringRoles(parsed.hiring_roles || '', confidence.hiring_roles || 0, minConfidence),
      required_skills: validateRequiredSkills(parsed.required_skills || '', confidence.required_skills || 0, minConfidence),
      confidence,
    };
  } catch (error) {
    if (isQuotaExceededError(error)) {
      geminiQuotaExceeded = true;
    }
    throw error;
  }
}

/**
 * Extract comprehensive enrichment data using LLM
 * DEPRECATED: Use targeted extraction functions above for better accuracy
 */
async function extractAllEnrichmentDataWithLLM(
  results: SearchResult[],
  companyName: string
): Promise<EnrichmentData & { confidence: ExtractionConfidence }> {
  const genAI = getGeminiClient();
  if (!genAI) {
    throw new Error('GEMINI_API_KEY not set');
  }

  const context = results
    .slice(0, 15) // Use top 15 results for comprehensive extraction
    .map((r, idx) => `[${idx + 1}] ${r.title}\n${r.snippet}\nURL: ${r.url}`)
    .join('\n\n');

  const prompt = `You are a strict data extraction agent. Extract ONLY information that is EXPLICITLY stated in the search results below about "${companyName}".

CRITICAL RULES - READ CAREFULLY:
1. ONLY extract information that is DIRECTLY mentioned in the search results
2. DO NOT infer, guess, or make up any information
3. DO NOT use common knowledge or assumptions
4. If information is not clearly stated, return an empty string
5. Set confidence to 0.0 if you're not certain the information is in the results

Search Results:
${context}

Extract the following information and return ONLY valid JSON (no markdown, no explanation):
{
  "founder_names": "Comma-separated full names of founders/CEOs EXPLICITLY mentioned in results, or empty string",
  "founder_linkedin": "LinkedIn profile URL EXPLICITLY mentioned in results, or empty string",
  "website": "Official company website domain EXPLICITLY mentioned (e.g., example.com), or empty string",
  "location": "City, State/Country EXPLICITLY mentioned (e.g., 'San Francisco, CA', 'London, UK'), or empty string",
  "industry": "Primary industry EXPLICITLY stated (e.g., 'Fintech', 'Healthcare', 'SaaS', 'AI'), or empty string",
  "funding_stage": "Funding stage EXPLICITLY mentioned (e.g., 'Seed', 'Series A', 'Series B', 'Series C', 'Pre-Seed', 'Bridge', 'IPO'), or empty string",
  "hiring_roles": "Job titles EXPLICITLY mentioned in job postings/careers pages, or empty string",
  "tech_stack": "Technologies EXPLICITLY mentioned in the results (not inferred), or empty string",
  "team_size": "Team size EXPLICITLY mentioned with numbers (e.g., '1-10', '10-50', '50-200', '200-500', '500+'), or empty string",
  "founder_backgrounds": "Previous companies/universities EXPLICITLY mentioned, or empty string",
  "website_keywords": "Keywords EXPLICITLY describing the company in results, or empty string",
  "confidence": {
    "founder_names": 0.0-1.0,
    "founder_linkedin": 0.0-1.0,
    "website": 0.0-1.0,
    "location": 0.0-1.0,
    "industry": 0.0-1.0,
    "funding_stage": 0.0-1.0,
    "hiring_roles": 0.0-1.0,
    "tech_stack": 0.0-1.0,
    "team_size": 0.0-1.0,
    "founder_backgrounds": 0.0-1.0,
    "website_keywords": 0.0-1.0
  }
}

STRICT EXTRACTION RULES:
- For founder_names: Only extract if full names (first + last) are EXPLICITLY stated. Do NOT extract generic names like "Team", "Founder", "CEO", or single first names only
- For founder_linkedin: Only extract if a LinkedIn URL is EXPLICITLY mentioned in the results
- For website: Extract ONLY the domain (e.g., "stripe.com"), not full URLs. NEVER extract search engines, social media, or news sites
- For location: Only extract if a specific city/location is EXPLICITLY mentioned
- For industry: Only extract if the industry is EXPLICITLY stated, not inferred from description
- For funding_stage: Only extract if funding stage is EXPLICITLY mentioned (not inferred from batch or other info)
- For hiring_roles: Only extract if specific job titles are EXPLICITLY mentioned in job postings
- For tech_stack: Only list technologies EXPLICITLY mentioned in the results. Do NOT infer based on industry
- For team_size: Only extract if a specific number or range is EXPLICITLY mentioned
- For founder_backgrounds: Only extract if previous companies/universities are EXPLICITLY mentioned
- For website_keywords: Only extract keywords EXPLICITLY used to describe the company

CONFIDENCE SCORING:
- Set confidence to 0.9+ only if information is EXPLICITLY stated multiple times
- Set confidence to 0.7-0.8 if information is clearly stated once
- Set confidence to 0.5-0.6 if information is implied but not explicit
- Set confidence to 0.0-0.4 if you're uncertain or inferring
- Return empty string if confidence < 0.7 for important fields

VALIDATION:
- Reject any extracted value that looks like a placeholder (e.g., "Team", "N/A", "TBD")
- Reject generic values that could apply to any company
- Cross-reference multiple results - if information conflicts, use the most common or set confidence lower`;

  try {
    // Rate limit before calling Gemini API
    await rateLimitGemini();
    
    // Use Flash model for cost-effectiveness (22.5x cheaper than Pro)
    // Try gemini-2.0-flash first, fallback to 2.5-flash, then 2.5-pro
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    const model = genAI.getGenerativeModel({ 
      model: modelName
    });
    
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const cleanedResponse = cleanJsonResponse(responseText);
    const parsed = JSON.parse(cleanedResponse);

    // Validate and clean extracted data
    const confidence = parsed.confidence || {};
    const minConfidence = 0.7; // Minimum confidence threshold to accept data
    
    // Validate founder names - reject placeholders and generic names
    let founder_names = parsed.founder_names || '';
    if (founder_names) {
      founder_names = validateFounderNames(founder_names, confidence.founder_names || 0, minConfidence);
    }
    
    // Validate founder LinkedIn - must be a valid LinkedIn URL
    let founder_linkedin = parsed.founder_linkedin || '';
    if (founder_linkedin) {
      founder_linkedin = validateLinkedIn(founder_linkedin, confidence.founder_linkedin || 0, minConfidence);
    }
    
    // Validate and clean website domain
    let website = parsed.website || '';
    if (website) {
      website = validateWebsite(website, confidence.website || 0, minConfidence);
    }
    
    // Validate location
    let location = parsed.location || '';
    if (location) {
      location = validateLocation(location, confidence.location || 0, minConfidence);
    }
    
    // Validate industry
    let industry = parsed.industry || '';
    if (industry) {
      industry = validateIndustry(industry, confidence.industry || 0, minConfidence);
    }
    
    // Validate funding stage
    let funding_stage = parsed.funding_stage || '';
    if (funding_stage) {
      funding_stage = validateFundingStage(funding_stage, confidence.funding_stage || 0, minConfidence);
    }
    
    // Validate hiring roles
    let hiring_roles = parsed.hiring_roles || '';
    if (hiring_roles) {
      hiring_roles = validateHiringRoles(hiring_roles, confidence.hiring_roles || 0, minConfidence);
    }
    
    // Validate tech stack
    let tech_stack = parsed.tech_stack || '';
    if (tech_stack) {
      tech_stack = validateTechStack(tech_stack, confidence.tech_stack || 0, minConfidence);
    }
    
    // Validate team size
    let team_size = parsed.team_size || '';
    if (team_size) {
      team_size = validateTeamSize(team_size, confidence.team_size || 0, minConfidence);
    }
    
    // Validate founder backgrounds
    let founder_backgrounds = parsed.founder_backgrounds || '';
    if (founder_backgrounds) {
      founder_backgrounds = validateFounderBackgrounds(founder_backgrounds, confidence.founder_backgrounds || 0, minConfidence);
    }
    
    // Validate website keywords
    let website_keywords = parsed.website_keywords || '';
    if (website_keywords) {
      website_keywords = validateWebsiteKeywords(website_keywords, confidence.website_keywords || 0, minConfidence);
    }

    return {
      founder_names,
      founder_linkedin,
      website,
      location,
      industry,
      funding_stage,
      funding_date: '', // Not extracted in this deprecated function
      hiring_roles,
      required_skills: '', // Not extracted in this deprecated function (replaces tech_stack)
      team_size,
      founder_backgrounds,
      website_keywords,
      confidence,
    };
  } catch (error) {
    // Check if quota exceeded
    if (isQuotaExceededError(error)) {
      geminiQuotaExceeded = true;
      console.warn('⚠️  Gemini quota exceeded. Disabling LLM extraction for this session. Using regex-only extraction.');
    }
    console.warn('LLM extraction failed, falling back to regex:', error instanceof Error ? error.message : String(error));
    throw error; // Will trigger fallback
  }
}

// ============================================================================
// REGEX-BASED EXTRACTION (Fallback)
// ============================================================================

/**
 * Extract founder information from search results (Regex-based fallback)
 */
function extractFounderInfoRegex(results: SearchResult[], companyName: string): {
  founder_names: string;
  founder_linkedin: string;
} {
  const allText = results.map(r => `${r.title} ${r.snippet}`).join(' ');
  
  // Extract LinkedIn profiles
  const linkedinPattern = /linkedin\.com\/in\/([a-zA-Z0-9-]+)/gi;
  const linkedinMatches = allText.match(linkedinPattern) || [];
  const linkedin = linkedinMatches[0] || '';
  
  // Extract names (look for patterns like "John Doe, CEO" or "founder John Doe")
  const namePatterns = [
    /(?:founder|CEO|co-founder|founder and CEO)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/gi,
    /([A-Z][a-z]+\s+[A-Z][a-z]+),\s*(?:founder|CEO|co-founder)/gi,
  ];
  
  const names: string[] = [];
  for (const pattern of namePatterns) {
    const matches = allText.matchAll(pattern);
    for (const match of matches) {
      if (match[1] && !names.includes(match[1])) {
        names.push(match[1]);
      }
    }
  }
  
  return {
    founder_names: names.join(', '),
    founder_linkedin: linkedin,
  };
}

/**
 * Extract founder information (Hybrid: LLM first, regex fallback)
 */
export async function extractFounderInfo(
  results: SearchResult[],
  companyName: string
): Promise<{
  founder_names: string;
  founder_linkedin: string;
  confidence?: ExtractionConfidence;
}> {
  // Try LLM extraction first if available and quota not exceeded
  if (process.env.GEMINI_API_KEY && !geminiQuotaExceeded) {
    try {
      const llmResult = await extractFounderInfoWithLLM(results, companyName);
      // Only use LLM results if confidence is reasonable
      if (
        (llmResult.confidence.founder_names || 0) >= 0.5 ||
        (llmResult.confidence.founder_linkedin || 0) >= 0.5
      ) {
        return llmResult;
      }
    } catch (error) {
      // Check if quota exceeded
      if (isQuotaExceededError(error)) {
        geminiQuotaExceeded = true;
        console.warn('⚠️  Gemini quota exceeded. Switching to regex-only extraction.');
      }
      console.warn('LLM extraction failed, using regex fallback:', error instanceof Error ? error.message : String(error));
    }
  } else if (geminiQuotaExceeded) {
    console.log('  ℹ️  Using regex-only extraction (Gemini quota exceeded)');
  }

  // Fallback to regex
  const regexResult = extractFounderInfoRegex(results, companyName);
  return {
    ...regexResult,
    confidence: {
      founder_names: regexResult.founder_names ? 0.6 : 0,
      founder_linkedin: regexResult.founder_linkedin ? 0.6 : 0,
    },
  };
}

/**
 * Extract job openings from search results (Regex-based)
 */
function extractJobOpeningsRegex(results: SearchResult[], companyName: string): string {
  const allText = results.map(r => `${r.title} ${r.snippet}`).join(' ');
  
  // Look for job titles
  const jobPatterns = [
    /(?:hiring|looking for|openings?|positions?)[\s:]+([A-Z][a-zA-Z\s,]+(?:Engineer|Developer|Designer|Manager|Intern|Analyst))/gi,
    /(?:Software|Product|Data|ML|AI|Frontend|Backend|Full.?Stack)\s+(?:Engineer|Developer|Intern|Manager)/gi,
  ];
  
  const jobs: string[] = [];
  for (const pattern of jobPatterns) {
    const matches = allText.matchAll(pattern);
    for (const match of matches) {
      const job = match[1] || match[0];
      if (job && !jobs.includes(job)) {
        jobs.push(job.trim());
      }
    }
  }
  
  return jobs.join(', ');
}

/**
 * Extract job openings (Hybrid: uses regex for now, can be enhanced with LLM)
 */
export function extractJobOpenings(results: SearchResult[], companyName: string): string {
  return extractJobOpeningsRegex(results, companyName);
}

/**
 * Check if a domain should be excluded (search engines, social media, news sites, etc.)
 */
function isExcludedDomain(domain: string): boolean {
  const excludedDomains = [
    // Search engines
    'duckduckgo.com',
    'google.com',
    'bing.com',
    'yahoo.com',
    'yandex.com',
    'baidu.com',
    // Social media
    'linkedin.com',
    'twitter.com',
    'facebook.com',
    'instagram.com',
    'youtube.com',
    'tiktok.com',
    // News/aggregator sites
    'crunchbase.com',
    'techcrunch.com',
    'bloomberg.com',
    'reuters.com',
    'wsj.com',
    'forbes.com',
    'medium.com',
    // Other aggregators
    'producthunt.com',
    'angel.co',
    'pitchbook.com',
    'cbinsights.com',
    // Generic domains
    'wikipedia.org',
    'reddit.com',
    'quora.com',
  ];
  
  const domainLower = domain.toLowerCase();
  return excludedDomains.some(excluded => 
    domainLower === excluded || domainLower.endsWith('.' + excluded)
  );
}

/**
 * Extract company website from search results (Regex-based)
 */
function extractCompanyWebsiteRegex(results: SearchResult[], companyName: string): string {
  // Look for the company's official website (usually first result or one with company name)
  for (const result of results) {
    try {
      const url = new URL(result.url);
      const domain = url.hostname.replace('www.', '');
      
      // Skip excluded domains
      if (isExcludedDomain(domain)) {
        continue;
      }
      
      // Check if domain name matches company name
      const companySlug = companyName.toLowerCase().replace(/\s+/g, '');
      if (domain.includes(companySlug) || result.title.toLowerCase().includes(companyName.toLowerCase())) {
        return domain;
      }
    } catch (error) {
      // Invalid URL, skip
      continue;
    }
  }
  
  // Return first non-excluded result
  for (const result of results) {
    try {
      const url = new URL(result.url);
      const domain = url.hostname.replace('www.', '');
      
      if (!isExcludedDomain(domain)) {
        return domain;
      }
    } catch (error) {
      // Invalid URL, skip
      continue;
    }
  }
  
  return '';
}

/**
 * Extract company website (Hybrid: uses regex for now)
 */
export function extractCompanyWebsite(results: SearchResult[], companyName: string): string {
  return extractCompanyWebsiteRegex(results, companyName);
}

/**
 * Extract tech stack from search results (Regex-based)
 * Looks for mentions of technologies, frameworks, languages, etc.
 */
function extractTechStackRegex(results: SearchResult[], companyName: string): string {
  const allText = results.map(r => `${r.title} ${r.snippet}`).join(' ').toLowerCase();
  
  // Common tech stack keywords
  const techKeywords = [
    // Languages
    'python', 'javascript', 'typescript', 'java', 'go', 'rust', 'ruby', 'php', 'swift', 'kotlin', 'dart',
    // Frameworks
    'react', 'vue', 'angular', 'next.js', 'nuxt', 'svelte', 'django', 'flask', 'fastapi', 'express', 'nestjs',
    'spring', 'laravel', 'rails', 'phoenix', 'gin', 'echo',
    // Databases
    'postgresql', 'mysql', 'mongodb', 'redis', 'elasticsearch', 'cassandra', 'dynamodb', 'firebase',
    // Cloud & Infrastructure
    'aws', 'azure', 'gcp', 'kubernetes', 'docker', 'terraform', 'ansible',
    // AI/ML
    'tensorflow', 'pytorch', 'scikit-learn', 'pandas', 'numpy', 'opencv',
    // Other
    'graphql', 'rest api', 'microservices', 'serverless', 'lambda', 'node.js', 'deno'
  ];
  
  const foundTech: string[] = [];
  for (const tech of techKeywords) {
    if (allText.includes(tech) && !foundTech.includes(tech)) {
      foundTech.push(tech);
    }
  }
  
  return foundTech.join(', ');
}

/**
 * Extract tech stack (Hybrid: uses regex for now)
 */
export function extractTechStack(results: SearchResult[], companyName: string): string {
  return extractTechStackRegex(results, companyName);
}


/**
 * Extract team size from search results (Regex-based)
 */
function extractTeamSizeRegex(results: SearchResult[], companyName: string): string {
  const allText = results.map(r => `${r.title} ${r.snippet}`).join(' ');
  
  // Look for team size patterns
  const teamSizePatterns = [
    /(?:team|employees?|staff|headcount|workforce).*?(?:of|is|has|with|about|around|approximately)?\s*(\d+)\s*(?:people|employees?|members?|staff)/i,
    /(\d+)\s*(?:people|employees?|members?|staff).*?(?:team|company|startup)/i,
    /(?:team|company|startup).*?(?:of|is|has|with|about|around|approximately)?\s*(\d+)/i,
  ];
  
  for (const pattern of teamSizePatterns) {
    const match = allText.match(pattern);
    if (match && match[1]) {
      const size = parseInt(match[1]);
      if (size > 0) {
        // Categorize into ranges
        if (size < 10) return '1-10';
        if (size < 50) return '10-50';
        if (size < 200) return '50-200';
        if (size < 500) return '200-500';
        return '500+';
      }
    }
  }
  
  // Look for range patterns
  const rangePattern = /(?:team|employees?|staff).*?(\d+)\s*[-–]\s*(\d+)/i;
  const rangeMatch = allText.match(rangePattern);
  if (rangeMatch) {
    return `${rangeMatch[1]}-${rangeMatch[2]}`;
  }
  
  return '';
}

/**
 * Extract team size (Hybrid: uses regex for now)
 */
export function extractTeamSize(results: SearchResult[], companyName: string): string {
  return extractTeamSizeRegex(results, companyName);
}

/**
 * Extract founder backgrounds (previous experience, education, etc.) (Regex-based)
 */
function extractFounderBackgroundsRegex(results: SearchResult[], companyName: string): string {
  const allText = results.map(r => `${r.title} ${r.snippet}`).join(' ');
  
  const backgrounds: string[] = [];
  
  // Look for previous company mentions
  const previousCompanyPattern = /(?:previously|formerly|ex-|former)\s+(?:at|worked at|founded|co-founded|led)\s+([A-Z][a-zA-Z0-9\s&.-]+)/gi;
  const companyMatches = allText.matchAll(previousCompanyPattern);
  for (const match of companyMatches) {
    if (match[1] && !backgrounds.includes(match[1])) {
      backgrounds.push(match[1]);
    }
  }
  
  // Look for education
  const educationPattern = /(?:graduated|studied|degree|alumni).*?(?:from|at)\s+([A-Z][a-zA-Z\s&.-]+(?:University|College|MIT|Stanford|Harvard|Berkeley|Yale|Princeton))/gi;
  const eduMatches = allText.matchAll(educationPattern);
  for (const match of eduMatches) {
    if (match[1] && !backgrounds.includes(match[1])) {
      backgrounds.push(match[1]);
    }
  }
  
  // Look for role titles
  const rolePattern = /(?:previously|formerly|ex-|former)\s+(?:CEO|CTO|CFO|VP|Director|Manager|Engineer|Developer|Designer|Product Manager)\s+(?:at|of)\s+([A-Z][a-zA-Z0-9\s&.-]+)/gi;
  const roleMatches = allText.matchAll(rolePattern);
  for (const match of roleMatches) {
    if (match[1] && !backgrounds.includes(match[1])) {
      backgrounds.push(match[1]);
    }
  }
  
  return backgrounds.join(', ');
}

/**
 * Extract founder backgrounds (Hybrid: uses regex for now)
 */
export function extractFounderBackgrounds(results: SearchResult[], companyName: string): string {
  return extractFounderBackgroundsRegex(results, companyName);
}

/**
 * Extract keywords from website content (from search results) (Regex-based)
 * This extracts relevant keywords that describe the company
 */
function extractWebsiteKeywordsRegex(results: SearchResult[], companyName: string): string {
  const allText = results.map(r => `${r.title} ${r.snippet}`).join(' ').toLowerCase();
  
  // Common startup/company keywords
  const keywordPatterns = [
    // Business models
    'saas', 'subscription', 'marketplace', 'platform', 'api', 'enterprise', 'b2b', 'b2c',
    // Technologies
    'ai', 'machine learning', 'blockchain', 'cloud', 'mobile', 'web', 'api-first',
    // Industries
    'fintech', 'healthtech', 'edtech', 'proptech', 'legaltech', 'insurtech',
    // Features
    'automation', 'analytics', 'security', 'compliance', 'integration', 'scalable',
    // Other
    'startup', 'scale-up', 'unicorn', 'y combinator', 'accelerator', 'incubator'
  ];
  
  const foundKeywords: string[] = [];
  for (const keyword of keywordPatterns) {
    if (allText.includes(keyword) && !foundKeywords.includes(keyword)) {
      foundKeywords.push(keyword);
    }
  }
  
  return foundKeywords.join(', ');
}

/**
 * Extract website keywords (Hybrid: uses regex for now)
 */
export function extractWebsiteKeywords(results: SearchResult[], companyName: string): string {
  return extractWebsiteKeywordsRegex(results, companyName);
}

/**
 * Comprehensive enrichment function that extracts all features
 */
export interface EnrichmentData {
  required_skills: string; // Skills/technologies required in job postings (replaces tech_stack)
  team_size: string;
  founder_backgrounds: string;
  website_keywords: string;
  hiring_roles: string; // job_openings
  website: string;
  founder_names: string;
  founder_linkedin: string;
  industry: string; // Primary industry category
  location: string; // Company headquarters location
  funding_stage: string; // Funding stage (Seed, Series A, etc.)
  funding_date: string; // Date of funding announcement
  confidence?: ExtractionConfidence;
}

/**
 * NEW: Multi-Query Targeted Extraction (RECOMMENDED)
 * Performs multiple specialized searches for better accuracy
 */
export async function extractWithMultipleQueries(companyName: string): Promise<EnrichmentData> {
  console.log(`    Using multi-query approach for: ${companyName}`);

  const enrichmentData: Partial<EnrichmentData> = {
    required_skills: '',
    team_size: '',
    founder_backgrounds: '',
    website_keywords: '',
    hiring_roles: '',
    website: '',
    founder_names: '',
    founder_linkedin: '',
    industry: '',
    location: '',
    funding_stage: '',
    funding_date: '',
  };

  const allConfidence: ExtractionConfidence = {};

  // Query 1: Company Overview
  try {
    console.log(`      Query 1/4: Company overview...`);
    const overviewQuery = `${companyName} startup company official website`;
    const overviewResults = await searchWeb(overviewQuery);
    if (overviewResults.length > 0) {
      const overview = await extractCompanyOverviewWithLLM(overviewResults, companyName);
      enrichmentData.website = overview.website || enrichmentData.website;
      enrichmentData.industry = overview.industry || enrichmentData.industry;
      enrichmentData.location = overview.location || enrichmentData.location;
      enrichmentData.website_keywords = overview.website_keywords || enrichmentData.website_keywords;
      Object.assign(allConfidence, overview.confidence);
    }
  } catch (error) {
    console.warn(`      Query 1 failed:`, error instanceof Error ? error.message : String(error));
  }

  // Query 2: Funding Information
  try {
    console.log(`      Query 2/4: Funding information...`);
    const fundingQuery = `${companyName} funding raised investment round`;
    const fundingResults = await searchWeb(fundingQuery);
    if (fundingResults.length > 0) {
      const funding = await extractFundingDataWithLLM(fundingResults, companyName);
      enrichmentData.funding_stage = funding.funding_stage || enrichmentData.funding_stage;
      enrichmentData.funding_date = funding.funding_date || enrichmentData.funding_date;
      // Note: funding_amount is handled separately to avoid overwriting TechCrunch data
      Object.assign(allConfidence, funding.confidence);
    }
  } catch (error) {
    console.warn(`      Query 2 failed:`, error instanceof Error ? error.message : String(error));
  }

  // Query 3: Team Information
  try {
    console.log(`      Query 3/4: Team & founders...`);
    const teamQuery = `${companyName} founder CEO team LinkedIn`;
    const teamResults = await searchWeb(teamQuery);
    if (teamResults.length > 0) {
      const team = await extractTeamDataWithLLM(teamResults, companyName);
      enrichmentData.founder_names = team.founder_names || enrichmentData.founder_names;
      enrichmentData.founder_linkedin = team.founder_linkedin || enrichmentData.founder_linkedin;
      enrichmentData.founder_backgrounds = team.founder_backgrounds || enrichmentData.founder_backgrounds;
      enrichmentData.team_size = team.team_size || enrichmentData.team_size;
      Object.assign(allConfidence, team.confidence);
    }
  } catch (error) {
    console.warn(`      Query 3 failed:`, error instanceof Error ? error.message : String(error));
  }

  // Query 4: Jobs & Skills (with fallback if no job listings)
  try {
    console.log(`      Query 4/4: Jobs & required skills...`);
    const jobsQuery = `${companyName} careers jobs hiring open positions`;
    const jobsResults = await searchWeb(jobsQuery);
    if (jobsResults.length > 0) {
      const jobs = await extractJobsAndSkillsWithLLM(jobsResults, companyName);
      enrichmentData.hiring_roles = jobs.hiring_roles || enrichmentData.hiring_roles;
      enrichmentData.required_skills = jobs.required_skills || enrichmentData.required_skills;
      Object.assign(allConfidence, jobs.confidence);

      // If no skills found from job listings, try alternative approach
      if (!enrichmentData.required_skills || enrichmentData.required_skills.trim() === '') {
        console.log(`      No skills in job listings, trying alternative query...`);
        // Fallback: Search for tech/engineering blog posts or tech descriptions
        const techQuery = `${companyName} engineering blog technology stack architecture`;
        const techResults = await searchWeb(techQuery);
        if (techResults.length > 0) {
          // Try to extract mentioned technologies from engineering content
          const extractedSkills = extractTechStackRegex(techResults, companyName);
          if (extractedSkills) {
            enrichmentData.required_skills = extractedSkills;
            allConfidence.required_skills = 0.5; // Lower confidence since inferred from blog/general mentions
            console.log(`      Found skills from tech content: ${extractedSkills.substring(0, 50)}...`);
          }
        }
      }
    }
  } catch (error) {
    console.warn(`      Query 4 failed:`, error instanceof Error ? error.message : String(error));
  }

  return {
    ...enrichmentData,
    confidence: allConfidence,
  } as EnrichmentData;
}

/**
 * Comprehensive enrichment (Hybrid: LLM first, regex fallback)
 * LEGACY: Consider using extractWithMultipleQueries for better accuracy
 */
export async function extractAllEnrichmentData(
  results: SearchResult[],
  companyName: string
): Promise<EnrichmentData> {
  // Try LLM extraction first if available and quota not exceeded
  if (process.env.GEMINI_API_KEY && !geminiQuotaExceeded) {
    try {
      const llmResult = await extractAllEnrichmentDataWithLLM(results, companyName);
      // Use LLM results if we got meaningful data (validation already filtered low-confidence data)
      // Check if we have any non-empty fields (validation ensures they meet confidence threshold)
      const hasGoodData = Object.entries(llmResult).some(
        ([key, value]) => key !== 'confidence' && value && typeof value === 'string' && value.trim().length > 0
      );
      if (hasGoodData) {
        return llmResult;
      }
    } catch (error) {
      // Check if quota exceeded
      if (isQuotaExceededError(error)) {
        geminiQuotaExceeded = true;
        console.warn('⚠️  Gemini quota exceeded. Switching to regex-only extraction.');
      }
      console.warn('LLM extraction failed, using regex fallback:', error instanceof Error ? error.message : String(error));
    }
  } else if (geminiQuotaExceeded) {
    console.log('  ℹ️  Using regex-only extraction (Gemini quota exceeded)');
  }

  // Fallback to regex-based extraction
  const founderInfo = await extractFounderInfo(results, companyName);

  // Extract location and industry from search results
  const allText = results.map(r => `${r.title} ${r.snippet}`).join(' ');
  const location = extractLocationFromText(allText);
  const industry = extractIndustryFromText(allText);

  return {
    required_skills: extractTechStack(results, companyName), // Using tech_stack extraction as fallback for required_skills
    team_size: extractTeamSize(results, companyName),
    founder_backgrounds: extractFounderBackgrounds(results, companyName),
    website_keywords: extractWebsiteKeywords(results, companyName),
    hiring_roles: extractJobOpenings(results, companyName),
    website: extractCompanyWebsite(results, companyName),
    location: location,
    industry: industry,
    funding_stage: '', // Regex fallback doesn't extract funding_stage (requires LLM)
    funding_date: '', // Regex fallback doesn't extract funding_date (requires LLM)
    founder_names: founderInfo.founder_names,
    founder_linkedin: founderInfo.founder_linkedin,
    confidence: founderInfo.confidence,
  };
}

/**
 * Extract location from text (simple regex-based)
 */
function extractLocationFromText(text: string): string {
  // Look for common city, state patterns
  const cityStatePattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?),\s*([A-Z]{2}|[A-Z][a-z]+)/g;
  const matches = text.matchAll(cityStatePattern);

  const commonCities = new Set(['San Francisco', 'New York', 'London', 'Boston', 'Seattle', 'Austin', 'Los Angeles', 'Chicago']);

  for (const match of matches) {
    const city = match[1];
    if (commonCities.has(city)) {
      return `${match[1]}, ${match[2]}`;
    }
  }

  // Return first match if no common city found
  const firstMatch = text.match(cityStatePattern);
  if (firstMatch) {
    return firstMatch[0];
  }

  return '';
}

/**
 * Extract industry from text (simple regex-based)
 */
function extractIndustryFromText(text: string): string {
  const textLower = text.toLowerCase();

  const industries = [
    { keywords: ['fintech', 'financial technology', 'payments'], value: 'Fintech' },
    { keywords: ['healthcare', 'health tech', 'medical'], value: 'Healthcare' },
    { keywords: ['saas', 'software as a service'], value: 'SaaS' },
    { keywords: ['artificial intelligence', 'machine learning', 'ai'], value: 'AI' },
    { keywords: ['e-commerce', 'ecommerce', 'online retail'], value: 'E-commerce' },
    { keywords: ['cybersecurity', 'security'], value: 'Security' },
    { keywords: ['blockchain', 'crypto', 'web3'], value: 'Blockchain' },
    { keywords: ['edtech', 'education'], value: 'EdTech' },
  ];

  for (const { keywords, value } of industries) {
    if (keywords.some(keyword => textLower.includes(keyword))) {
      return value;
    }
  }

  return '';
}

