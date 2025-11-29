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
  extractAllEnrichmentData,
  isGeminiQuotaExceeded
} from './web_search_agent';

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
  founder_emails?: string;
  founder_linkedin?: string;
  website?: string;
  job_openings?: string;
  description?: string;
  funding_amount?: string;
  funding_stage?: string;
  location?: string;
  industry?: string;
  company_logo?: string;
  yc_link?: string;
  tech_stack?: string;
  target_customer?: string;
  market_vertical?: string;
  team_size?: string;
  founder_backgrounds?: string;
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
  
  // Primary approach: Comprehensive LLM extraction (Cursor-like - one search, extract everything)
  // This is more efficient and accurate than multiple targeted searches
  // Note: Will automatically fall back to regex if Gemini quota exceeded
  // Skip LLM if we know quota is exceeded
  const shouldUseLLM = process.env.GEMINI_API_KEY && !isGeminiQuotaExceeded();
  
  if (shouldUseLLM) {
    try {
      // Build a comprehensive query that will capture all information
      // Include description keywords if available to improve search relevance
      let generalQuery = `${companyName}`;
      if (startup.description) {
        // Extract key terms from description (first 50 chars) to improve search
        const descKeywords = startup.description
          .split(/\s+/)
          .slice(0, 5)
          .filter(w => w.length > 3)
          .join(' ');
        if (descKeywords) {
          generalQuery += ` ${descKeywords}`;
        }
      }
      generalQuery += ` startup founders team website`;
      
      console.log(`    Using comprehensive extraction: ${generalQuery}`);
      const allResults = await searchWeb(generalQuery);
      
      if (allResults.length > 0) {
        console.log(`    Found ${allResults.length} search results, extracting with LLM...`);
        const comprehensive = await extractAllEnrichmentData(allResults, companyName);
        
        // Map comprehensive results to EnrichedData format
        const result: EnrichedData = {
          founder_names: comprehensive.founder_names || '',
          founder_linkedin: comprehensive.founder_linkedin || '',
          founder_emails: comprehensive.founder_emails || '',
          website: comprehensive.website || '',
          location: comprehensive.location || '',
          industry: comprehensive.industry || '',
          job_openings: comprehensive.hiring_roles || '',
          tech_stack: comprehensive.tech_stack || '',
          target_customer: comprehensive.target_customer || '',
          market_vertical: comprehensive.market_vertical || '',
          team_size: comprehensive.team_size || '',
          founder_backgrounds: comprehensive.founder_backgrounds || '',
        };
        
        // Log what we found
        const foundFields = Object.entries(result)
          .filter(([_, value]) => value && value.trim())
          .map(([key, _]) => key)
          .join(', ');
        console.log(`    ✅ Extracted: ${foundFields || 'none'}`);
        
        return result;
      } else {
        console.warn(`    ⚠️  No search results found, falling back to targeted searches`);
      }
    } catch (error) {
      console.warn(`    ⚠️  Comprehensive extraction failed, using targeted searches:`, error instanceof Error ? error.message : String(error));
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
      if (founderInfo.founder_emails) enrichedData.founder_emails = founderInfo.founder_emails;
      
      // Log confidence scores if available
      if (founderInfo.confidence) {
        const conf = founderInfo.confidence;
        console.log(`    Confidence: names=${(conf.founder_names || 0).toFixed(2)}, linkedin=${(conf.founder_linkedin || 0).toFixed(2)}, emails=${(conf.founder_emails || 0).toFixed(2)}`);
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
 * 2. This enrichment agent uses web search to find ALL other data:
 *    - Website, location, industry
 *    - Founders, emails, LinkedIn
 *    - Tech stack, target customer, market vertical
 *    - Team size, founder backgrounds
 *    - Job openings
 */
/**
 * Check if a field is null or undefined (not just empty string)
 */
function isNullOrUndefined(value: any): boolean {
  return value === null || value === undefined;
}

function mergeEnrichedData(existing: StartupRecord, enriched: EnrichedData): Partial<StartupRecord> {
  const updates: Partial<StartupRecord> = {};

  // Only update fields that are null or undefined (not empty strings or existing values)
  if (enriched.founder_names && isNullOrUndefined(existing.founder_names)) {
    updates.founder_names = enriched.founder_names;
  }

  if (enriched.founder_emails && isNullOrUndefined(existing.founder_emails)) {
    updates.founder_emails = enriched.founder_emails;
  }

  if (enriched.founder_linkedin && isNullOrUndefined(existing.founder_linkedin)) {
    updates.founder_linkedin = enriched.founder_linkedin;
  }

  if (enriched.website && isNullOrUndefined(existing.website)) {
    // Only update if null (TechCrunch scraper doesn't extract this, so it should be null)
    updates.website = enriched.website;
  }

  if (enriched.job_openings && isNullOrUndefined(existing.job_openings)) {
    updates.job_openings = enriched.job_openings;
  }

  // Description: Only update if null (TechCrunch should have provided description)
  if (enriched.description && isNullOrUndefined(existing.description)) {
    updates.description = enriched.description;
  }

  // Funding amount: Only update if null (TechCrunch should have this)
  if (enriched.funding_amount && isNullOrUndefined(existing.funding_amount)) {
    updates.funding_amount = enriched.funding_amount;
  }

  if (enriched.location && isNullOrUndefined(existing.location)) {
    // Only update if null (TechCrunch scraper doesn't extract this, so it should be null)
    updates.location = enriched.location;
  }

  if (enriched.industry && isNullOrUndefined(existing.industry)) {
    // Only update if null (TechCrunch scraper doesn't extract this, so it should be null)
    updates.industry = enriched.industry;
  }

  // Add new comprehensive fields - only update if null
  if (enriched.tech_stack && isNullOrUndefined(existing.tech_stack)) {
    updates.tech_stack = enriched.tech_stack;
  }

  if (enriched.target_customer && isNullOrUndefined(existing.target_customer)) {
    updates.target_customer = enriched.target_customer;
  }

  if (enriched.market_vertical && isNullOrUndefined(existing.market_vertical)) {
    updates.market_vertical = enriched.market_vertical;
  }

  if (enriched.team_size && isNullOrUndefined(existing.team_size)) {
    updates.team_size = enriched.team_size;
  }

  if (enriched.founder_backgrounds && isNullOrUndefined(existing.founder_backgrounds)) {
    updates.founder_backgrounds = enriched.founder_backgrounds;
  }

  // Generate keywords from industry and target_customer if available - only if keywords is null
  if ((enriched.industry || enriched.target_customer) && isNullOrUndefined(existing.keywords)) {
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
    
    // Merge enriched data
    const updates = mergeEnrichedData(startup, enrichedData);
    
    if (Object.keys(updates).length > 0) {
      // Filter out fields that might not exist in database (new columns from migration)
      // Only include fields that are known to exist in the startups table
      const knownColumns = [
        'founder_names', 'founder_emails', 'founder_linkedin',
        'website', 'job_openings', 'description', 'funding_amount',
        'funding_stage', 'location', 'industry',
        // New columns (only include if migration has been run)
        'tech_stack', 'target_customer', 'market_vertical', 
        'team_size', 'founder_backgrounds', 'website_keywords'
      ];
      
      const safeUpdates: Partial<StartupRecord> = {};
      for (const [key, value] of Object.entries(updates)) {
        if (knownColumns.includes(key) && value !== undefined && value !== null) {
          safeUpdates[key] = value;
        }
      }
      
      // Update startup in Supabase
      // Note: updated_at is automatically handled by database trigger
      const { error } = await supabase
        .from('startups')
        .update({
          ...safeUpdates,
          needs_enrichment: false,
          enrichment_status: 'completed',
        })
        .eq('id', startup.id);
      
      if (error) {
        // If error is about missing column, try again without new columns
        if (error.message?.includes('Could not find') || error.code === 'PGRST204') {
          console.warn(`  ⚠️  Some columns may not exist in database. Retrying without new columns...`);
          const basicColumns = [
            'founder_names', 'founder_emails', 'founder_linkedin',
            'website', 'job_openings', 'description', 'funding_amount',
            'funding_stage', 'location', 'industry'
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
              needs_enrichment: false,
              enrichment_status: 'completed',
            })
            .eq('id', startup.id);
          
          if (retryError) {
            throw retryError;
          }
          
          console.log(`  ✅ Enriched with: ${Object.keys(basicUpdates).join(', ')}`);
          return true;
        }
        throw error;
      }
      
      console.log(`  ✅ Enriched with: ${Object.keys(safeUpdates).join(', ')}`);
      return true;
    } else {
      // No new data found, mark as completed anyway
      await supabase
        .from('startups')
        .update({
          needs_enrichment: false,
          enrichment_status: 'completed',
        })
        .eq('id', startup.id);
      
      console.log(`  ℹ️  No additional data found`);
      return true;
    }
  } catch (error) {
    console.error(`  ❌ Error enriching ${startup.name}:`, error);
    
    // Mark as failed
    await supabase
      .from('startups')
      .update({ enrichment_status: 'failed' })
      .eq('id', startup.id);
    
    return false;
  }
}

/**
 * Get startups that need enrichment
 */
async function getStartupsNeedingEnrichment(limit: number = 10): Promise<StartupRecord[]> {
  const { data, error } = await supabase
    .from('startups')
    .select('*')
    .eq('needs_enrichment', true)
    .in('enrichment_status', ['pending', 'failed'])
    .limit(limit);
  
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
  
  let successCount = 0;
  let errorCount = 0;
  
  for (let i = 0; i < startups.length; i++) {
    const startup = startups[i];
    const success = await enrichStartup(startup);
    
    if (success) {
      successCount++;
    } else {
      errorCount++;
    }
    
    // Add delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log(`\n=== Enrichment Complete ===`);
  console.log(`Total processed: ${startups.length}`);
  console.log(`Successfully enriched: ${successCount}`);
  console.log(`Errors: ${errorCount}`);
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

