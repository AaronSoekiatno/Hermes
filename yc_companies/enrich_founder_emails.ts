/**
 * Batch Founder Email Enrichment
 * 
 * This script enriches startups in Supabase with founder emails using pattern matching.
 * It processes companies in batches with configurable rate limiting.
 * 
 * Usage:
 *   npx tsx yc_companies/enrich_founder_emails.ts
 *   npx tsx yc_companies/enrich_founder_emails.ts --batch=10  # Process 10 at a time
 *   npx tsx yc_companies/enrich_founder_emails.ts --limit=50  # Only process 50 companies
 *   npx tsx yc_companies/enrich_founder_emails.ts --rate-limit=1000  # Set hourly rate limit (default: unlimited)
 *   npx tsx yc_companies/enrich_founder_emails.ts --patterns=4  # Try N patterns per founder (default: 2)
 *   npx tsx yc_companies/enrich_founder_emails.ts --primary-only  # Only process primary founder per startup
 * 
 * API Info:
 *   - Rapid Email Verifier: Unlimited, free, open source
 *   - Supports batch validation (up to 100 emails at once)
 *   - ~25ms average response time
 *   - Each founder tries N email patterns (configurable, default: 2)
 * 
 * Note: The API is unlimited, but you can set a rate limit to be respectful.
 * For high-volume processing, consider implementing batch validation.
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { discoverFounderEmails } from './founder_email_discovery';

// Initialize Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
}

const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey);

interface StartupRecord {
  id: string;
  name: string;
  website?: string;
  founder_names?: string;
  founder_linkedin?: string;
  founder_emails?: string;
  data_source?: string;
}

/**
 * Get startups that need founder email enrichment
 */
async function getStartupsNeedingEmailEnrichment(limit?: number): Promise<StartupRecord[]> {
  const query = supabase
    .from('startups')
    .select('id, name, website, founder_names, founder_linkedin, founder_emails, data_source')
    .or('founder_emails.is.null,founder_emails.eq.')
    .not('founder_names', 'is', null)
    .not('website', 'is', null)
    .eq('data_source', 'yc');

  if (limit) {
    query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching startups:', error);
    throw error;
  }

  // Filter out companies that already have emails
  return (data || []).filter(startup => {
    const hasEmails = startup.founder_emails && 
                     startup.founder_emails.trim() && 
                     startup.founder_emails.trim() !== '';
    const hasFounders = startup.founder_names && 
                       startup.founder_names.trim() && 
                       startup.founder_names.trim() !== '';
    return !hasEmails && hasFounders;
  });
}

/**
 * Extract domain from website URL
 */
function extractDomain(website: string): string | null {
  if (!website) return null;
  
  try {
    const url = new URL(website);
    return url.hostname.replace('www.', '');
  } catch {
    // Already a domain, clean it up
    return website.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

/**
 * Parse founder names from comma-separated string
 */
function parseFounderNames(founderNames: string): Array<{ name: string; linkedin?: string }> {
  if (!founderNames) return [];
  
  const names = founderNames.split(',').map(n => n.trim()).filter(n => n.length > 0);
  return names.map(name => ({ name }));
}

/**
 * Parse founder LinkedIn URLs from comma-separated string
 */
function parseFounderLinkedIns(founderLinkedIns?: string): string[] {
  if (!founderLinkedIns) return [];
  return founderLinkedIns.split(',').map(li => li.trim()).filter(li => li.length > 0);
}

/**
 * Match founders with their LinkedIn URLs
 */
function matchFoundersWithLinkedIns(
  founders: Array<{ name: string }>,
  linkedIns: string[]
): Array<{ name: string; linkedin?: string }> {
  // Simple matching - if counts match, assume order matches
  if (founders.length === linkedIns.length) {
    return founders.map((founder, i) => ({
      name: founder.name,
      linkedin: linkedIns[i],
    }));
  }
  
  return founders;
}

/**
 * Update startup with founder emails
 */
async function updateStartupWithEmails(
  startupId: string,
  founderEmails: string[]
): Promise<boolean> {
  try {
    const emailsString = founderEmails.filter(email => email && email.trim()).join(', ');
    
    const { error } = await supabase
      .from('startups')
      .update({
        founder_emails: emailsString || null,
      })
      .eq('id', startupId);

    if (error) {
      console.error(`  ⚠️  Error updating emails: ${error.message}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`  ❌ Error updating emails: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Main enrichment function
 */
async function enrichFounderEmails() {
  console.log('📧 Starting Founder Email Enrichment...\n');

  // Get command line arguments
  const args = process.argv.slice(2);
  const batchSizeArg = args.find(arg => arg.startsWith('--batch='))?.split('=')[1];
  const limitArg = args.find(arg => arg.startsWith('--limit='))?.split('=')[1];
  const rateLimitArg = args.find(arg => arg.startsWith('--rate-limit='))?.split('=')[1];
  const patternsArg = args.find(arg => arg.startsWith('--patterns='))?.split('=')[1];
  const primaryOnly = args.includes('--primary-only');
  
  const batchSize = batchSizeArg ? parseInt(batchSizeArg, 10) : 5;
  const limit = limitArg ? parseInt(limitArg, 10) : undefined;
  const maxPatterns = patternsArg ? parseInt(patternsArg, 10) : 2; // Default to 2 for efficiency
  
  // Optional rate limiting (API is unlimited, but we can be respectful)
  // Rate limit is per hour to allow for sustained processing
  const RATE_LIMIT_PER_HOUR = rateLimitArg ? parseInt(rateLimitArg, 10) : Infinity;
  let emailApiCallsUsed = 0;
  let rateLimitStartTime = Date.now();
  let rateLimitCount = 0;
  
  console.log(`⚙️  Configuration:`);
  console.log(`   Patterns per founder: ${maxPatterns}`);
  console.log(`   Primary founder only: ${primaryOnly ? 'Yes' : 'No'}`);
  
  if (RATE_LIMIT_PER_HOUR === Infinity) {
    console.log(`📊 Rate Limit: Unlimited (API supports unlimited validations)`);
  } else {
    console.log(`📊 Rate Limit: ${RATE_LIMIT_PER_HOUR} verifications/hour`);
    const foundersPerHour = Math.floor(RATE_LIMIT_PER_HOUR / maxPatterns);
    const startupsPerHour = primaryOnly ? foundersPerHour : Math.floor(foundersPerHour / 2);
    console.log(`   Capacity: ~${foundersPerHour} founders/hour (~${startupsPerHour} startups/hour)`);
  }

  // Test Supabase connection
  try {
    const { error } = await supabase.from('startups').select('id').limit(1);
    if (error && error.code !== 'PGRST116') {
      throw error;
    }
    console.log('✓ Connected to Supabase\n');
  } catch (error) {
    throw new Error(`Cannot connect to Supabase: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Get startups needing enrichment
  console.log('🔍 Finding startups that need email enrichment...');
  const startups = await getStartupsNeedingEmailEnrichment(limit);
  console.log(`   Found ${startups.length} startups needing enrichment\n`);

  if (startups.length === 0) {
    console.log('✅ All startups already have founder emails!');
    return;
  }

  // Calculate strategy for processing
  if (startups.length >= 100) {
    const avgFoundersPerStartup = primaryOnly ? 1 : 2;
    const totalApiCallsNeeded = startups.length * avgFoundersPerStartup * maxPatterns;
    
    let estimatedHours: number;
    if (RATE_LIMIT_PER_HOUR === Infinity) {
      // Estimate based on API response time (~25ms) + delays (~500ms between emails)
      const timePerCall = 0.525; // seconds (25ms API + 500ms delay)
      estimatedHours = (totalApiCallsNeeded * timePerCall) / 3600;
    } else {
      estimatedHours = totalApiCallsNeeded / RATE_LIMIT_PER_HOUR;
    }
    const estimatedDays = Math.ceil(estimatedHours / 24);
    
    console.log(`\n📊 Processing Strategy for ${startups.length} startups:`);
    console.log(`   Total API calls needed: ~${totalApiCallsNeeded}`);
    console.log(`   Estimated time: ~${estimatedHours.toFixed(1)} hours (~${estimatedDays} days)`);
    console.log(`   Rate limit: ${RATE_LIMIT_PER_HOUR === Infinity ? 'Unlimited' : `${RATE_LIMIT_PER_HOUR} calls/hour`}`);
    console.log('');
  }

  let successCount = 0;
  let emailsFoundCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  // Process in batches
  for (let i = 0; i < startups.length; i += batchSize) {
    const batch = startups.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(startups.length / batchSize);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`📦 Processing Batch ${batchNum}/${totalBatches} (${batch.length} startups)`);
    console.log('='.repeat(60));

    for (const startup of batch) {
      // Check hourly rate limit if set
      if (RATE_LIMIT_PER_HOUR !== Infinity) {
        const now = Date.now();
        const hoursSinceStart = (now - rateLimitStartTime) / (1000 * 60 * 60);
        
        // Reset counter if an hour has passed
        if (hoursSinceStart >= 1) {
          rateLimitStartTime = now;
          rateLimitCount = 0;
        }
        
        // Check if we've exceeded the hourly limit
        if (rateLimitCount >= RATE_LIMIT_PER_HOUR) {
          const waitMinutes = Math.ceil((1 - hoursSinceStart) * 60);
          console.log(`\n⏳ Rate limit reached (${RATE_LIMIT_PER_HOUR}/hour). Waiting ${waitMinutes} minutes...`);
          await new Promise(resolve => setTimeout(resolve, (1 - hoursSinceStart) * 60 * 60 * 1000));
          rateLimitStartTime = Date.now();
          rateLimitCount = 0;
        }
      }

      try {
        console.log(`\n🏢 Processing: ${startup.name}`);
        console.log(`   ID: ${startup.id}`);
        console.log(`   Website: ${startup.website || 'N/A'}`);

        if (!startup.website) {
          console.log('   ⚠️  No website, skipping...');
          skippedCount++;
          continue;
        }

        if (!startup.founder_names) {
          console.log('   ⚠️  No founder names, skipping...');
          skippedCount++;
          continue;
        }

        // Extract domain
        const domain = extractDomain(startup.website);
        if (!domain) {
          console.log('   ⚠️  Could not extract domain, skipping...');
          skippedCount++;
          continue;
        }

        console.log(`   Domain: ${domain}`);

        // Parse founder names and LinkedIn URLs
        const founderNames = parseFounderNames(startup.founder_names);
        const linkedIns = parseFounderLinkedIns(startup.founder_linkedin);
        let founders = matchFoundersWithLinkedIns(founderNames, linkedIns);

        if (founders.length === 0) {
          console.log('   ⚠️  No valid founders found, skipping...');
          skippedCount++;
          continue;
        }

        // If primary-only mode, only process the first founder
        if (primaryOnly && founders.length > 1) {
          console.log(`   📌 Primary-only mode: Processing first founder only (${founders.length} total)`);
          founders = [founders[0]];
        }

        console.log(`   Founders: ${founders.length}`);
        founders.forEach(f => {
          console.log(`      - ${f.name}${f.linkedin ? ` (${f.linkedin})` : ''}`);
        });

        // Discover emails with configurable pattern count
        const emailResult = await discoverFounderEmails(
          founders.map(f => ({
            name: f.name,
            linkedin: f.linkedin,
          })),
          domain,
          maxPatterns
        );

        // Track API calls (each founder tries maxPatterns)
        const apiCallsThisStartup = founders.length * maxPatterns;
        emailApiCallsUsed += apiCallsThisStartup;
        rateLimitCount += apiCallsThisStartup;

        if (emailResult.emailsFound > 0) {
          emailsFoundCount += emailResult.emailsFound;
          const founderEmails = emailResult.founders
            .filter(f => f.email)
            .map(f => f.email!);

          console.log(`   ✅ Found ${emailResult.emailsFound} email(s):`);
          founderEmails.forEach(email => console.log(`      - ${email}`));

          // Update Supabase
          const updated = await updateStartupWithEmails(startup.id, founderEmails);
          if (updated) {
            successCount++;
            console.log('   ✅ Successfully updated in Supabase');
          } else {
            errorCount++;
            console.log('   ❌ Failed to update in Supabase');
          }
        } else {
          console.log(`   ℹ️  No emails found for ${startup.name}`);
          skippedCount++;
        }

        // Small delay between companies to be respectful (API is fast ~25ms)
        if (i + batchSize < startups.length) {
          await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay (reduced from 3s)
        }

      } catch (error) {
        errorCount++;
        console.error(`   ❌ Error processing ${startup.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Small delay between batches
    if (i + batchSize < startups.length) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay (reduced from 5s)
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Enrichment Complete');
  console.log('='.repeat(60));
  console.log(`Total processed: ${startups.length}`);
  console.log(`Successfully enriched: ${successCount}`);
  console.log(`Emails found: ${emailsFoundCount}`);
  console.log(`Skipped: ${skippedCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Total API calls: ${emailApiCallsUsed}${RATE_LIMIT_PER_HOUR !== Infinity ? ` (limit: ${RATE_LIMIT_PER_HOUR}/hour)` : ' (unlimited)'}`);
  console.log('='.repeat(60));
}

// Run the enrichment
if (require.main === module) {
  enrichFounderEmails()
    .then(() => {
      console.log('\n✅ Process completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Process failed:', error);
      process.exit(1);
    });
}

export { enrichFounderEmails };

