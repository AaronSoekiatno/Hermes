/**
 * Reasoning Agent for Web Search Enrichment
 * 
 * This agent reasons about:
 * 1. What data is missing
 * 2. Where to find it (which sources)
 * 3. How to search for it (what queries)
 * 4. Whether found data is relevant and correct
 * 5. Whether more searches are needed
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { SearchResult, rateLimitGemini } from './web_search_agent';

interface StartupRecord {
  id: string;
  name: string;
  description?: string;
  website?: string;
  founder_names?: string;
  founder_linkedin?: string;
  founder_emails?: string;
  job_openings?: string;
  funding_amount?: string;
  funding_stage?: string;
  tech_stack?: string;
  [key: string]: any;
}

interface MissingDataAnalysis {
  missingFields: string[];
  priority: 'high' | 'medium' | 'low';
  reasoning: string;
}

interface SearchPlan {
  queries: SearchQuery[];
  reasoning: string;
  expectedSources: string[];
}

export interface SearchQuery {
  query: string;
  purpose: string;
  source: 'general' | 'linkedin' | 'crunchbase' | 'company_website' | 'news' | 'github' | 'twitter';
  priority: number;
}

interface RelevanceCheck {
  isRelevant: boolean;
  confidence: number;
  reasoning: string;
  extractedData?: any;
}

interface ValidationResult {
  isValid: boolean;
  confidence: number;
  issues: string[];
  correctedData?: any;
}

/**
 * Get Gemini client
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

// Global flag to track if Gemini quota is exceeded
let geminiQuotaExceeded = false;

/**
 * Check if an error indicates quota exceeded (not just rate limit)
 */
function isQuotaExceededError(error: any): boolean {
  if (!error) return false;
  const errorStr = error.toString() + JSON.stringify(error);
  return (
    error.status === 429 ||
    errorStr.includes('429') ||
    errorStr.includes('quota') ||
    errorStr.includes('Quota exceeded') ||
    errorStr.includes('exceeded your current quota') ||
    errorStr.includes('free_tier_requests')
  );
}

/**
 * Retry with exponential backoff for rate limit errors
 * Throws special error if quota exceeded (not just rate limited)
 */
async function callGeminiWithRetry<T>(
  callFn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 2000
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await callFn();
    } catch (error: any) {
      lastError = error;
      
      // Check if quota exceeded (not just rate limited)
      if (isQuotaExceededError(error)) {
        geminiQuotaExceeded = true;
        console.warn('⚠️  Gemini quota exceeded. Disabling LLM reasoning for this session.');
        throw new Error('QUOTA_EXCEEDED'); // Special error to signal quota exceeded
      }
      
      // Check if it's a rate limit error (temporary)
      const isRateLimit = 
        error?.message?.includes('429') ||
        error?.message?.includes('rate limit') ||
        error?.message?.includes('Too Many Requests');
      
      if (isRateLimit && attempt < maxRetries - 1) {
        // Try to extract retry delay from error
        let delay = baseDelay * Math.pow(2, attempt); // Exponential backoff
        
        const retryMatch = error?.message?.match(/retry in ([\d.]+)s/i);
        if (retryMatch) {
          delay = Math.ceil(parseFloat(retryMatch[1]) * 1000) + 1000; // Add 1s buffer
        }
        
        console.warn(`  ⚠️  Rate limited, waiting ${Math.ceil(delay / 1000)}s before retry ${attempt + 2}/${maxRetries}...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // If not rate limit or last attempt, throw
      throw error;
    }
  }
  
  throw lastError;
}

/**
 * Analyze what data is missing from a startup record
 */
export async function analyzeMissingData(startup: StartupRecord): Promise<MissingDataAnalysis> {
  const genAI = getGeminiClient();
  if (!genAI) {
    // Fallback to simple analysis
    const missing: string[] = [];
    if (!startup.founder_names) missing.push('founder_names');
    if (!startup.founder_linkedin) missing.push('founder_linkedin');
    if (!startup.founder_emails) missing.push('founder_emails');
    if (!startup.website) missing.push('website');
    if (!startup.job_openings) missing.push('job_openings');
    
    return {
      missingFields: missing,
      priority: missing.length > 3 ? 'high' : 'medium',
      reasoning: 'Basic field check',
    };
  }

  // Use gemini-2.5-pro for free tier (has 2 RPM, 125K TPM, 50 RPD limits)
  // Fallback to gemini-1.5-flash if 2.5-pro not available
  // Rate limit before calling Gemini API
  await rateLimitGemini();
  
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

  const prompt = `Analyze this startup record and determine what information is missing and should be enriched.

Startup Data:
- Name: ${startup.name}
- Description: ${startup.description || 'N/A'}
- Website: ${startup.website || 'N/A'}
- Founder Names: ${startup.founder_names || 'MISSING'}
- Founder LinkedIn: ${startup.founder_linkedin || 'MISSING'}
- Founder Emails: ${startup.founder_emails || 'MISSING'}
- Job Openings: ${startup.job_openings || 'MISSING'}
- Funding Amount: ${startup.funding_amount || 'MISSING'}
- Tech Stack: ${startup.tech_stack || 'MISSING'}

Return JSON:
{
  "missingFields": ["field1", "field2", ...],
  "priority": "high" | "medium" | "low",
  "reasoning": "Why these fields are important and should be prioritized"
}

Consider:
- Founder information is critical for outreach
- Website is needed for verification
- Job openings show they're hiring
- Funding info shows growth stage
- Tech stack helps with matching`;

  try {
    const result = await callGeminiWithRetry(() => model.generateContent(prompt));
    const responseText = result.response.text();
    const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.warn('LLM analysis failed, using fallback:', error instanceof Error ? error.message : String(error));
  }

  // Fallback
  const missing: string[] = [];
  if (!startup.founder_names) missing.push('founder_names');
  if (!startup.founder_linkedin) missing.push('founder_linkedin');
  if (!startup.founder_emails) missing.push('founder_emails');
  if (!startup.website) missing.push('website');
  if (!startup.job_openings) missing.push('job_openings');

  return {
    missingFields: missing,
    priority: missing.length > 3 ? 'high' : 'medium',
    reasoning: 'Basic field check',
  };
}

/**
 * Generate a search plan based on missing data
 * This is where the agent REASONS about WHERE and HOW to find data
 */
export async function generateSearchPlan(
  startup: StartupRecord,
  missingData: MissingDataAnalysis
): Promise<SearchPlan> {
  const genAI = getGeminiClient();
  if (!genAI) {
    // Fallback to simple queries
    const queries: SearchQuery[] = [];
    if (missingData.missingFields.includes('founder_names')) {
      queries.push({
        query: `${startup.name} founder CEO co-founder`,
        purpose: 'Find founder names',
        source: 'general',
        priority: 1,
      });
    }
    if (missingData.missingFields.includes('website')) {
      queries.push({
        query: `${startup.name} official website`,
        purpose: 'Find company website',
        source: 'company_website',
        priority: 2,
      });
    }
    return {
      queries,
      reasoning: 'Basic search queries',
      expectedSources: ['general'],
    };
  }

  // Use gemini-2.5-pro for free tier (has 2 RPM, 125K TPM, 50 RPD limits)
  // Fallback to gemini-1.5-flash if 2.5-pro not available
  // Rate limit before calling Gemini API
  await rateLimitGemini();
  
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

  const prompt = `You are a research agent. Generate a search plan to find missing information about "${startup.name}".

Missing Information: ${missingData.missingFields.join(', ')}
Company Description: ${startup.description || 'N/A'}
Current Website: ${startup.website || 'N/A'}

Reason about WHERE to find each piece of missing data:
- Founder names: LinkedIn, company about page, news articles, Crunchbase
- Founder LinkedIn: LinkedIn search, company team page
- Founder emails: Company website contact page, LinkedIn, email finder tools
- Website: General search, company name + "official website"
- Job openings: Company careers page, LinkedIn jobs, job boards
- Funding info: Crunchbase, TechCrunch, news articles
- Tech stack: Company blog, GitHub, job postings, engineering blog

Generate 3-5 specific search queries that will find this information. Consider:
1. What search terms will yield best results?
2. Which sources are most reliable?
3. What order should searches be done in?

Return JSON:
{
  "queries": [
    {
      "query": "exact search query",
      "purpose": "what this search will find",
      "source": "general" | "linkedin" | "crunchbase" | "company_website" | "news" | "github" | "twitter",
      "priority": 1-5 (1 is highest)
    }
  ],
  "reasoning": "Why these queries and sources were chosen",
  "expectedSources": ["source1", "source2", ...]
}`;

  try {
    const result = await callGeminiWithRetry(() => model.generateContent(prompt));
    const responseText = result.response.text();
    const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.warn('LLM search plan generation failed, using fallback:', error instanceof Error ? error.message : String(error));
  }

  // Fallback
  const queries: SearchQuery[] = [];
  if (missingData.missingFields.includes('founder_names')) {
    queries.push({
      query: `${startup.name} founder CEO co-founder`,
      purpose: 'Find founder names',
      source: 'general',
      priority: 1,
    });
  }
  return { queries, reasoning: 'Basic queries', expectedSources: ['general'] };
}

/**
 * Check if search results are relevant to what we're looking for
 * This is where the agent UNDERSTANDS if data matches
 */
export async function checkRelevance(
  results: SearchResult[],
  searchQuery: SearchQuery,
  startup: StartupRecord
): Promise<RelevanceCheck> {
  const genAI = getGeminiClient();
  if (!genAI) {
    // Simple fallback: check if company name appears in results
    const relevant = results.some(r => 
      r.title.toLowerCase().includes(startup.name.toLowerCase()) ||
      r.snippet.toLowerCase().includes(startup.name.toLowerCase())
    );
    return {
      isRelevant: relevant,
      confidence: relevant ? 0.7 : 0.3,
      reasoning: relevant ? 'Company name found in results' : 'Company name not found',
    };
  }

  // Use gemini-2.5-pro for free tier (has 2 RPM, 125K TPM, 50 RPD limits)
  // Fallback to gemini-1.5-flash if 2.5-pro not available
  // Rate limit before calling Gemini API
  await rateLimitGemini();
  
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

  const resultsText = results
    .slice(0, 5)
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}\n${r.url}`)
    .join('\n\n');

  const prompt = `Evaluate if these search results are relevant for finding "${searchQuery.purpose}" about "${startup.name}".

Search Purpose: ${searchQuery.purpose}
Search Query: ${searchQuery.query}
Company: ${startup.name}
Company Description: ${startup.description || 'N/A'}

Search Results:
${resultsText}

Determine:
1. Are these results about the correct company (${startup.name})?
2. Do they contain the information we're looking for (${searchQuery.purpose})?
3. How confident are you?

Return JSON:
{
  "isRelevant": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "Why these results are or aren't relevant",
  "extractedData": {
    // If relevant, extract the data we're looking for
    // e.g., if looking for founders: { "founder_names": "John Doe, Jane Smith" }
  }
}`;

  try {
    const result = await callGeminiWithRetry(() => model.generateContent(prompt));
    const responseText = result.response.text();
    const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.warn('LLM relevance check failed, using fallback:', error instanceof Error ? error.message : String(error));
  }

  // Fallback
  const relevant = results.some(r => 
    r.title.toLowerCase().includes(startup.name.toLowerCase()) ||
    r.snippet.toLowerCase().includes(startup.name.toLowerCase())
  );
  return {
    isRelevant: relevant,
    confidence: relevant ? 0.7 : 0.3,
    reasoning: relevant ? 'Company name found' : 'Company name not found',
  };
}

/**
 * Validate extracted data for correctness and completeness
 * This is where the agent UNDERSTANDS if data matches and is correct
 */
export async function validateExtractedData(
  extractedData: any,
  field: string,
  startup: StartupRecord
): Promise<ValidationResult> {
  const genAI = getGeminiClient();
  if (!genAI) {
    // Simple validation
    return {
      isValid: true,
      confidence: 0.6,
      issues: [],
    };
  }

  // Use gemini-2.5-pro for free tier (has 2 RPM, 125K TPM, 50 RPD limits)
  // Fallback to gemini-1.5-flash if 2.5-pro not available
  // Rate limit before calling Gemini API
  await rateLimitGemini();
  
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

  const prompt = `Validate this extracted data for "${startup.name}".

Field: ${field}
Extracted Value: ${JSON.stringify(extractedData)}
Company Name: ${startup.name}
Company Description: ${startup.description || 'N/A'}

Check:
1. Is this data about the correct company (${startup.name})?
2. Is the format correct?
3. Does it make sense?
4. Are there any obvious errors?

Return JSON:
{
  "isValid": true/false,
  "confidence": 0.0-1.0,
  "issues": ["issue1", "issue2", ...],
  "correctedData": {
    // If invalid, provide corrected version
  }
}`;

  try {
    const result = await callGeminiWithRetry(() => model.generateContent(prompt));
    const responseText = result.response.text();
    const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.warn('LLM validation failed, using fallback:', error instanceof Error ? error.message : String(error));
  }

  return {
    isValid: true,
    confidence: 0.6,
    issues: [],
  };
}

/**
 * Decide if more searches are needed
 */
export async function shouldContinueSearching(
  currentData: Partial<StartupRecord>,
  missingData: MissingDataAnalysis,
  attempts: number
): Promise<{ continue: boolean; reasoning: string }> {
  const genAI = getGeminiClient();
  if (!genAI) {
    // Simple logic
    const stillMissing = missingData.missingFields.filter(field => !currentData[field]);
    return {
      continue: stillMissing.length > 0 && attempts < 3,
      reasoning: stillMissing.length > 0 ? 'Still missing data' : 'All data found',
    };
  }

  // Use gemini-2.5-pro for free tier (has 2 RPM, 125K TPM, 50 RPD limits)
  // Fallback to gemini-1.5-flash if 2.5-pro not available
  // Rate limit before calling Gemini API
  await rateLimitGemini();
  
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

  const prompt = `Decide if we should continue searching for missing information.

Original Missing Fields: ${missingData.missingFields.join(', ')}
Current Attempts: ${attempts}
Currently Found: ${Object.keys(currentData).join(', ')}

Should we:
1. Continue searching (if critical data still missing)?
2. Stop (if we have enough or searches are not productive)?

Return JSON:
{
  "continue": true/false,
  "reasoning": "Why we should or shouldn't continue"
}`;

  try {
    const result = await callGeminiWithRetry(() => model.generateContent(prompt));
    const responseText = result.response.text();
    const cleaned = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.warn('LLM decision failed, using fallback:', error instanceof Error ? error.message : String(error));
  }

  const stillMissing = missingData.missingFields.filter(field => !currentData[field]);
  return {
    continue: stillMissing.length > 0 && attempts < 3,
    reasoning: stillMissing.length > 0 ? 'Still missing data' : 'All data found',
  };
}

