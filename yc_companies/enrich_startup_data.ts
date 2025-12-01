/**
 * Web Search Enrichment Agent
 * 
 * This agent takes startups that need enrichment and uses web search
 * to find additional information like:
 * - Founder names and LinkedIn profiles
 * - Accurate company website
 * - Job openings
 * - More detailed company description
 * - Additional funding details
 * - Company logo/YC link if applicable
 * 
 * NOTE: Founder emails are NOT extracted here. They are handled separately
 * by the email_pattern_matcher.ts and founder_email_discovery.ts modules.
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  searchWeb,
  extractFounderInfo,
  extractJobOpenings,
  extractCompanyWebsite,
  extractWithMultipleQueries,
  isGeminiQuotaExceeded
} from './web_search_agent';
import {
  calculateEnrichmentQuality,
  getEnrichmentStatus,
  getQualitySummary,
} from './enrichment_quality';

// Initialize Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey);

interface StartupRecord {
  id: string;
  name: string;
  website?: string;
  description?: string;
  techcrunch_article_link?: string;
  techcrunch_article_content?: string;
  [key: string]: any;
}

interface EnrichedData {
  founder_names?: string;
  founder_linkedin?: string;
  website?: string;
  job_openings?: string;
  description?: string;
  funding_amount?: string;
  funding_stage?: string;
  funding_date?: string;
  location?: string;
  industry?: string;
  company_logo?: string;
  yc_link?: string;
  required_skills?: string;
  target_customer?: string;
  market_vertical?: string;
  team_size?: string;
  founder_backgrounds?: string;
  website_keywords?: string;
}

/**
 * Search the web for information about a startup
 * 
 * Uses targeted searches for specific information.
 * For better accuracy with LLM extraction, consider using extractAllEnrichmentData
 * which performs comprehensive extraction from combined search results.
 */
async function searchWebForStartup(startup: StartupRecord): Promise<EnrichedData> {
  const companyName = startup.name;
  const existingWebsite = startup.website;
  const articleContent = startup.techcrunch_article_content || '';

  console.log(`  🔍 Searching web for: ${companyName}`);

  const enrichedData: EnrichedData = {};

  // NEW APPROACH: Multi-Query Targeted Extraction
  // Performs 4 specialized searches for better accuracy:
  // 1. Company overview (website, industry, location)
  // 2. Funding information (amount, stage, date)
  // 3. Team information (founders, backgrounds, size)
  // 4. Jobs & Skills (hiring roles, required skills from job postings)

  const shouldUseLLM = process.env.GEMINI_API_KEY && !isGeminiQuotaExceeded();

  if (shouldUseLLM) {
    try {
      console.log(`    Using multi-query targeted extraction...`);
      const comprehensive = await extractWithMultipleQueries(companyName);

      // Map comprehensive results to EnrichedData format
      const result: EnrichedData = {
        founder_names: comprehensive.founder_names || '',
        founder_linkedin: comprehensive.founder_linkedin || '',
        website: comprehensive.website || '',
        location: comprehensive.location || '',
        industry: comprehensive.industry || '',
        funding_stage: comprehensive.funding_stage || '',
        funding_date: comprehensive.funding_date || '',
        job_openings: comprehensive.hiring_roles || '',
        required_skills: comprehensive.required_skills || '',
        target_customer: comprehensive.target_customer || '',
        market_vertical: comprehensive.market_vertical || '',
        team_size: comprehensive.team_size || '',
        founder_backgrounds: comprehensive.founder_backgrounds || '',
        website_keywords: comprehensive.website_keywords || '',
      };

      // Log what we found
      const foundFields = Object.entries(result)
        .filter(([_, value]) => value && value.trim())
        .map(([key, _]) => key)
        .join(', ');
      console.log(`    ✅ Extracted: ${foundFields || 'none'}`);

      return result;
    } catch (error) {
      console.warn(`    ⚠️  Multi-query extraction failed, using fallback searches:`, error instanceof Error ? error.message : String(error));
    }
  }
  
  // Fallback: Targeted searches (if comprehensive extraction not available or failed)
  try {
    // Search for founder information
    const founderQuery = `${companyName} founder CEO co-founder`;
    console.log(`    Searching for founders: ${founderQuery}`);
    const founderResults = await searchWeb(founderQuery);
    
    if (founderResults.length > 0) {
      const founderInfo = await extractFounderInfo(founderResults, companyName);
      if (founderInfo.founder_names) enrichedData.founder_names = founderInfo.founder_names;
      if (founderInfo.founder_linkedin) enrichedData.founder_linkedin = founderInfo.founder_linkedin;
      // Log confidence scores if available
      if (founderInfo.confidence) {
        const conf = founderInfo.confidence;
        console.log(`    Confidence: names=${(conf.founder_names || 0).toFixed(2)}, linkedin=${(conf.founder_linkedin || 0).toFixed(2)}`);
      }
    }
    
    // Search for job openings
    const jobsQuery = `${companyName} careers jobs hiring open positions`;
    console.log(`    Searching for jobs: ${jobsQuery}`);
    const jobsResults = await searchWeb(jobsQuery);
    
    if (jobsResults.length > 0) {
      const jobs = extractJobOpenings(jobsResults, companyName);
      if (jobs) enrichedData.job_openings = jobs;
    }
    
    // Search for company website (if not already have one or it looks generated)
    if (!existingWebsite || existingWebsite.includes('.com') && !existingWebsite.includes('.')) {
      const websiteQuery = `${companyName} official website`;
      console.log(`    Searching for website: ${websiteQuery}`);
      const websiteResults = await searchWeb(websiteQuery);
      
      if (websiteResults.length > 0) {
        const website = extractCompanyWebsite(websiteResults, companyName);
        if (website) enrichedData.website = website;
      }
    }
    
    // Search for more funding details if we have default/placeholder values
    if (!startup.funding_amount || startup.funding_amount === '$1.5M') {
      const fundingQuery = `${companyName} funding raised investment`;
      console.log(`    Searching for funding: ${fundingQuery}`);
      const fundingResults = await searchWeb(fundingQuery);
      
      // Extract funding amount from results
      const fundingText = fundingResults.map(r => r.snippet).join(' ');
      const fundingMatch = fundingText.match(/\$(\d+(?:\.\d+)?)\s*(?:million|M|billion|B)/i);
      if (fundingMatch) {
        enrichedData.funding_amount = `$${fundingMatch[1]}${fundingMatch[0].includes('billion') || fundingMatch[0].includes('B') ? 'B' : 'M'}`;
      }
    }
    
  } catch (error) {
    console.warn(`  ⚠️  Web search error: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  return enrichedData;
}


/**
 * Merge enriched data with existing startup data
 *
 * WORKFLOW:
 * 1. TechCrunch scraper extracts ONLY: company name, funding amount/stage/date, and article description
 * 2. This enrichment agent uses web search to find:
 *    - Website, location, industry
 *    - Founders, LinkedIn profiles
 *    - Funding stage (round_type)
 *    - Tech stack, target customer, market vertical
 *    - Team size, founder backgrounds
 *    - Job openings
 * 
 * NOTE: Founder emails are handled separately by email_pattern_matcher.ts
 * and founder_email_discovery.ts (pattern matching approach).
 */
/**
 * Parse founder names from comma-separated string into array format
 */
function parseFounderNames(
  founderNamesString: string | null | undefined,
  linkedinString?: string | null | undefined
): Array<{ name: string; role?: string; linkedin?: string }> {
  if (!founderNamesString) return [];

  const founders = founderNamesString
    .split(',')
    .map(name => name.trim())
    .filter(name => name.length > 0);

  // If we have a LinkedIn URL, we can't easily match it to specific founders
  // So we'll only assign it to the first founder as a best guess
  const linkedinUrl = linkedinString?.trim() || undefined;

  return founders.map((name, index) => ({
    name,
    linkedin: index === 0 ? linkedinUrl : undefined, // Assign LinkedIn to first founder
  }));
}

/**
 * Check if a field is null, undefined, or empty string
 */
function isEmptyOrNull(value: any): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/**
 * Check if a value looks like a placeholder/default value
 */
function isPlaceholderValue(value: any, field: string): boolean {
  if (!value || typeof value !== 'string') return false;
  const lower = value.toLowerCase().trim();
  
  // Common placeholder patterns
  if (field === 'founder_names' && (lower === 'team' || lower === 'founder' || lower === 'n/a')) {
    return true;
  }
  if (field === 'website' && (!lower.includes('.') || lower === 'website.com' || lower === 'example.com')) {
    return true;
  }
  return false;
}

/**
 * Check if a funding amount is a placeholder/default value
 */
function isPlaceholderFundingAmount(value: any): boolean {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim().toLowerCase();
  
  const placeholderAmounts = [
    '$1.5m',
    '$1.5 m',
    '1.5m',
    '1.5 m',
    '$1.5 million',
    '$500k-$2m',
    'n/a',
    'tbd',
    'to be determined',
  ];
  
  return placeholderAmounts.includes(trimmed);
}

/**
 * Check if a funding stage is a placeholder (conservative - only obvious placeholders)
 */
function isPlaceholderFundingStage(value: any): boolean {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim().toLowerCase();
  
  const placeholderStages = [
    'n/a',
    'na',
    'tbd',
    'to be determined',
    'unknown',
    'default',
    'not specified',
  ];
  
  return placeholderStages.includes(trimmed);
}

function mergeEnrichedData(existing: StartupRecord, enriched: EnrichedData): Partial<StartupRecord> {
  const updates: Partial<StartupRecord> = {};

  // Update fields if they're empty/null OR if they look like placeholders
  // This allows overwriting placeholder data with real extracted data
  if (enriched.founder_names && enriched.founder_names.trim()) {
    const shouldUpdate = isEmptyOrNull(existing.founder_names) || isPlaceholderValue(existing.founder_names, 'founder_names');
    if (shouldUpdate) {
      updates.founder_names = enriched.founder_names.trim();
    }
  }

  if (enriched.founder_linkedin && (isEmptyOrNull(existing.founder_linkedin) || isPlaceholderValue(existing.founder_linkedin, 'founder_linkedin'))) {
    updates.founder_linkedin = enriched.founder_linkedin;
  }

  if (enriched.website && (isEmptyOrNull(existing.website) || isPlaceholderValue(existing.website, 'website'))) {
    updates.website = enriched.website;
  }

  if (enriched.job_openings && isEmptyOrNull(existing.job_openings)) {
    updates.job_openings = enriched.job_openings;
  }

  // Description: Only update if null/empty (TechCrunch should have provided description)
  if (enriched.description && isEmptyOrNull(existing.description)) {
    updates.description = enriched.description;
  }

  // Funding amount: Update if null/empty OR if it's a placeholder value
  if (enriched.funding_amount && enriched.funding_amount.trim()) {
    const extractedIsPlaceholder = isPlaceholderFundingAmount(enriched.funding_amount);
    const existingIsPlaceholder = existing.funding_amount && 
                                   isPlaceholderFundingAmount(existing.funding_amount);
    
    const shouldUpdate = isEmptyOrNull(existing.funding_amount) || 
                         existingIsPlaceholder;
    
    // Only update if extracted value is not also a placeholder
    if (shouldUpdate && !extractedIsPlaceholder) {
      updates.funding_amount = enriched.funding_amount.trim();
      console.log(`      📊 Updating funding_amount: "${existing.funding_amount || 'null'}" → "${enriched.funding_amount.trim()}"`);
    }
  }

  // Funding stage: Map to round_type column, update if null/empty OR if it's a placeholder
  if (enriched.funding_stage && enriched.funding_stage.trim()) {
    const extractedIsPlaceholder = isPlaceholderFundingStage(enriched.funding_stage);
    const existingIsPlaceholder = existing.round_type && 
                                   isPlaceholderFundingStage(existing.round_type);
    
    const shouldUpdate = isEmptyOrNull(existing.round_type) || 
                         existingIsPlaceholder;
    
    // Additional check: if existing is "Seed" (common default) and we found a more specific stage
    // AND existing funding amount is placeholder, consider updating
    const existingIsSeed = existing.round_type?.toLowerCase().trim() === 'seed';
    const extractedIsMoreSpecific = enriched.funding_stage.trim() !== 'Seed' && 
                                     enriched.funding_stage.trim().length > 0;
    const hasPlaceholderFunding = existing.funding_amount && 
                                   isPlaceholderFundingAmount(existing.funding_amount);
    
    // Update if it's a placeholder, or if Seed + placeholder funding + more specific stage found
    if ((shouldUpdate || (existingIsSeed && extractedIsMoreSpecific && hasPlaceholderFunding)) && 
        !extractedIsPlaceholder) {
      updates.round_type = enriched.funding_stage.trim();
      console.log(`      📊 Updating round_type: "${existing.round_type || 'null'}" → "${enriched.funding_stage.trim()}"`);
    }
  }

  if (enriched.location && isEmptyOrNull(existing.location)) {
    updates.location = enriched.location;
  }

  if (enriched.industry && isEmptyOrNull(existing.industry)) {
    updates.industry = enriched.industry;
  }

  // Add new comprehensive fields - update if null/empty
  if (enriched.required_skills && enriched.required_skills.trim() && isEmptyOrNull(existing.required_skills)) {
    updates.required_skills = enriched.required_skills.trim();
  }

  if (enriched.target_customer && enriched.target_customer.trim() && isEmptyOrNull(existing.target_customer)) {
    updates.target_customer = enriched.target_customer.trim();
  }

  if (enriched.market_vertical && enriched.market_vertical.trim() && isEmptyOrNull(existing.market_vertical)) {
    updates.market_vertical = enriched.market_vertical.trim();
  }

  if (enriched.team_size && enriched.team_size.trim() && isEmptyOrNull(existing.team_size)) {
    updates.team_size = enriched.team_size.trim();
  }

  if (enriched.founder_backgrounds && enriched.founder_backgrounds.trim() && isEmptyOrNull(existing.founder_backgrounds)) {
    updates.founder_backgrounds = enriched.founder_backgrounds.trim();
  }

  // Add website_keywords if extracted
  if (enriched.website_keywords && enriched.website_keywords.trim() && isEmptyOrNull(existing.website_keywords)) {
    updates.website_keywords = enriched.website_keywords.trim();
  }

  // Add funding_date if extracted
  if (enriched.funding_date && enriched.funding_date.trim() && isEmptyOrNull(existing.date)) {
    updates.date = enriched.funding_date.trim();
  }

  // Generate keywords from industry and target_customer if available - only if keywords is null/empty
  if ((enriched.industry || enriched.target_customer) && isEmptyOrNull(existing.keywords)) {
    const keywordParts = [enriched.industry, enriched.target_customer].filter(Boolean);
    if (keywordParts.length > 0) {
      updates.keywords = keywordParts.join(', ');
    }
  }

  return updates;
}

/**
 * Enrich a single startup
 */
async function enrichStartup(startup: StartupRecord): Promise<boolean> {
  try {
    console.log(`\n📊 Enriching: ${startup.name}`);
    
    // Update status to in_progress
    await supabase
      .from('startups')
      .update({ enrichment_status: 'in_progress' })
      .eq('id', startup.id);
    
    // Search web for additional information
    const enrichedData = await searchWebForStartup(startup);
    
    // Debug: Log what was extracted
    const extractedFields = Object.entries(enrichedData)
      .filter(([_, value]) => value && typeof value === 'string' && value.trim().length > 0)
      .map(([key, value]) => `${key}=${String(value).substring(0, 50)}${String(value).length > 50 ? '...' : ''}`)
      .join(', ');
    console.log(`  🔍 Extracted data: ${extractedFields || 'none'}`);
    
    // Merge enriched data
    const updates = mergeEnrichedData(startup, enrichedData);
    
    // Debug: Log what will be updated
    if (Object.keys(updates).length > 0) {
      console.log(`  📝 Will update: ${Object.keys(updates).join(', ')}`);
    } else {
      console.log(`  ⚠️  No updates to apply - no new data found or all fields already populated`);
    }
    
    // Create confidence scores for extracted data
    // Simple enricher doesn't have detailed confidence, so we estimate based on source
    const confidence: Record<string, number> = {};
    for (const [field, value] of Object.entries(updates)) {
      if (value) {
        // LLM-extracted data gets higher confidence (0.8)
        // Regex-extracted data gets lower confidence (0.6)
        // Since we use extractAllEnrichmentData which uses LLM, default to 0.75
        confidence[field] = 0.75;
      }
    }
    
    // Calculate enrichment quality
    const mergedData = { ...startup, ...updates };
    const quality = calculateEnrichmentQuality(mergedData, updates, confidence);
    const enrichmentStatus = getEnrichmentStatus(quality);
    
    console.log(`  📊 Quality Assessment: ${getQualitySummary(quality)}`);
    if (quality.issues.length > 0) {
      console.log(`  ⚠️  Issues: ${quality.issues.join('; ')}`);
    }
    
    if (Object.keys(updates).length > 0) {
      // Filter out fields that might not exist in database (new columns from migration)
      // Only include fields that are known to exist in the startups table
      const knownColumns = [
        'founder_names', 'founder_emails', 'founder_linkedin',
        'website', 'job_openings', 'description', 'funding_amount',
        'round_type', 'date', 'location', 'industry',
        // New columns (only include if migration has been run)
        'required_skills', 'target_customer', 'market_vertical',
        'team_size', 'founder_backgrounds', 'website_keywords'
      ];
      
      const safeUpdates: Partial<StartupRecord> = {};
      for (const [key, value] of Object.entries(updates)) {
        if (knownColumns.includes(key) && value !== undefined && value !== null) {
          safeUpdates[key] = value;
        }
      }
      
      // Add quality metrics
      const finalUpdates: any = {
        ...safeUpdates,
        enrichment_quality_score: quality.overallScore,
        enrichment_quality_status: quality.status,
        enrichment_status: enrichmentStatus,
        needs_enrichment: enrichmentStatus !== 'completed',
      };
      
      // Update startup in Supabase
      // Note: updated_at is automatically handled by database trigger
      const { error } = await supabase
        .from('startups')
        .update(finalUpdates)
        .eq('id', startup.id);
      
      if (error) {
        // If error is about missing column, try again without new columns
        if (error.message?.includes('Could not find') || error.code === 'PGRST204' || error.message?.includes('enrichment_quality')) {
          console.warn(`  ⚠️  Some columns may not exist in database. Retrying without new/quality columns...`);
          const basicColumns = [
            'founder_names', 'founder_emails', 'founder_linkedin',
            'website', 'job_openings', 'description', 'funding_amount',
            'round_type', 'location', 'industry'
          ];
          const basicUpdates: Partial<StartupRecord> = {};
          for (const [key, value] of Object.entries(updates)) {
            if (basicColumns.includes(key) && value !== undefined && value !== null) {
              basicUpdates[key] = value;
            }
          }
          
          const { error: retryError } = await supabase
            .from('startups')
            .update({
              ...basicUpdates,
              enrichment_status: enrichmentStatus,
              needs_enrichment: enrichmentStatus !== 'completed',
            })
            .eq('id', startup.id);
          
          if (retryError) {
            throw retryError;
          }
          
          console.log(`  ✅ Enriched with: ${Object.keys(basicUpdates).join(', ')}`);
          console.log(`  📊 Quality: ${quality.status} (${(quality.overallScore * 100).toFixed(0)}%)`);
          return enrichmentStatus !== 'failed';
        }
        throw error;
      }
      
      const updatedFields = Object.keys(safeUpdates);
      if (updatedFields.length > 0) {
        console.log(`  ✅ Enriched with: ${updatedFields.join(', ')}`);
      }
      console.log(`  📊 Quality: ${quality.status} (${(quality.overallScore * 100).toFixed(0)}%)`);
      console.log(`  📋 Status: ${enrichmentStatus}`);
      return enrichmentStatus !== 'failed';
    } else {
      // No new data found, but still calculate and update quality
      const qualityUpdates: any = {
        enrichment_quality_score: quality.overallScore,
        enrichment_quality_status: quality.status,
        enrichment_status: enrichmentStatus,
        needs_enrichment: enrichmentStatus !== 'completed',
      };
      
      const { error } = await supabase
        .from('startups')
        .update(qualityUpdates)
        .eq('id', startup.id);
      
      if (error && !error.message?.includes('enrichment_quality')) {
        // If quality columns don't exist, just update status
        await supabase
          .from('startups')
          .update({
            enrichment_status: enrichmentStatus,
            needs_enrichment: enrichmentStatus !== 'completed',
          })
          .eq('id', startup.id);
      }
      
      console.log(`  ℹ️  No additional data found`);
      console.log(`  📊 Quality: ${quality.status} (${(quality.overallScore * 100).toFixed(0)}%)`);
      console.log(`  📋 Status: ${enrichmentStatus}`);
      return enrichmentStatus !== 'failed';
    }
  } catch (error) {
    console.error(`  ❌ Error enriching ${startup.name}:`, error);
    
    // Calculate quality even on error to see what we got
    try {
      const enrichedData = await searchWebForStartup(startup).catch(() => ({}));
      const updates = mergeEnrichedData(startup, enrichedData);
      const confidence: Record<string, number> = {};
      for (const [field, value] of Object.entries(updates)) {
        if (value) confidence[field] = 0.5; // Lower confidence on error
      }
      
      const mergedData = { ...startup, ...updates };
      const quality = calculateEnrichmentQuality(mergedData, updates, confidence);
      console.log(`  📊 Quality before failure: ${getQualitySummary(quality)}`);
      
      await supabase
        .from('startups')
        .update({
          enrichment_status: 'failed',
          enrichment_quality_score: quality.overallScore,
          enrichment_quality_status: quality.status,
        })
        .eq('id', startup.id);
    } catch (updateError) {
      // If quality columns don't exist or calculation fails, just update status
      await supabase
        .from('startups')
        .update({ enrichment_status: 'failed' })
        .eq('id', startup.id);
    }
    
    return false;
  }
}

/**
 * Get startups that need enrichment
 */
async function getStartupsNeedingEnrichment(limit?: number): Promise<StartupRecord[]> {
  let query = supabase
    .from('startups')
    .select('*')
    .eq('needs_enrichment', true)
    .in('enrichment_status', ['pending', 'failed', 'needs_review'])
    .order('created_at', { ascending: true }); // Process oldest first
  
  if (limit) {
    query = query.limit(limit);
  }
  
  const { data, error } = await query;
  
  if (error) {
    throw error;
  }
  
  return data || [];
}

/**
 * Main enrichment function
 */
async function enrichStartups(limit?: number) {
  console.log('🚀 Starting startup data enrichment...\n');
  
  // Get startups that need enrichment
  const startups = await getStartupsNeedingEnrichment(limit);
  
  if (startups.length === 0) {
    console.log('✅ No startups need enrichment!');
    return;
  }
  
  console.log(`Found ${startups.length} startups needing enrichment\n`);
  console.log(`Processing with 2 second delay between startups...\n`);
  
  let successCount = 0;
  let errorCount = 0;
  const errors: Array<{ name: string; error: string }> = [];
  
  for (let i = 0; i < startups.length; i++) {
    const startup = startups[i];
    const progress = `[${i + 1}/${startups.length}]`;
    
    console.log(`\n${progress} Processing: ${startup.name}`);
    
    try {
      const success = await enrichStartup(startup);
      
      if (success) {
        successCount++;
        console.log(`  ✅ Enriched successfully`);
      } else {
        errorCount++;
        console.log(`  ⚠️  Enrichment completed with warnings`);
      }
    } catch (error) {
      errorCount++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push({ name: startup.name, error: errorMsg });
      console.log(`  ❌ Error: ${errorMsg}`);
    }
    
    // Add delay to avoid rate limiting (except for last item)
    if (i < startups.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Enrichment Complete`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Total processed: ${startups.length}`);
  console.log(`✅ Successfully enriched: ${successCount}`);
  console.log(`❌ Errors: ${errorCount}`);
  
  if (errors.length > 0) {
    console.log(`\n⚠️  Errors encountered:`);
    errors.forEach(({ name, error }) => {
      console.log(`  - ${name}: ${error}`);
    });
  }
  
  // Show remaining count if we processed a limited batch
  if (limit && startups.length >= limit) {
    const { data: remaining } = await supabase
      .from('startups')
      .select('id', { count: 'exact', head: true })
      .eq('needs_enrichment', true)
      .in('enrichment_status', ['pending', 'failed', 'needs_review']);
    
    if (remaining) {
      console.log(`\n💡 Note: There may be more startups needing enrichment.`);
      console.log(`   Run again to process more: npm run enrich-startups ${limit}`);
    }
  }
}

/**
 * Enrich a specific startup by ID
 */
async function enrichStartupById(startupId: string) {
  const { data, error } = await supabase
    .from('startups')
    .select('*')
    .eq('id', startupId)
    .single();
  
  if (error || !data) {
    throw new Error(`Startup not found: ${startupId}`);
  }
  
  await enrichStartup(data);
}

// Run if called directly
if (require.main === module) {
  // Get all arguments (npm passes them after --)
  const args = process.argv.slice(2);
  
  // Debug: log all arguments
  if (args.length > 0) {
    console.log(`📝 Received arguments: ${args.join(', ')}`);
  }
  
  // Check for --id= parameter in any argument
  let startupId: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--id=')) {
      startupId = arg.replace('--id=', '').trim();
      break;
    }
    // Also check for --id <value> format
    if (arg === '--id' && i + 1 < args.length) {
      startupId = args[i + 1].trim();
      break;
    }
  }
  
  if (startupId) {
    // Enrich specific startup by ID
    console.log(`🎯 Enriching startup with ID: ${startupId}\n`);
    enrichStartupById(startupId)
      .then(() => {
        console.log('\n✅ Enrichment completed!');
        process.exit(0);
      })
      .catch((error) => {
        console.error('\n❌ Enrichment failed:', error);
        process.exit(1);
      });
  } else {
    // Enrich all startups needing enrichment
    // Filter out -- flags to find numeric limit
    const numericArgs = args.filter(arg => !arg.startsWith('--') && !isNaN(parseInt(arg)));
    const limit = numericArgs.length > 0 ? parseInt(numericArgs[0]) : undefined;
    enrichStartups(limit)
      .then(() => {
        console.log('\n✅ Enrichment completed!');
        process.exit(0);
      })
      .catch((error) => {
        console.error('\n❌ Enrichment failed:', error);
        process.exit(1);
      });
  }
}

export { enrichStartups, enrichStartupById, enrichStartup };

