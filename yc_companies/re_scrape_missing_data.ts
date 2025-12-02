/**
 * Re-scrape Missing Data from YC Pages
 * 
 * This script identifies startups missing critical fields (founder names, emails, website)
 * and re-scrapes them from YC pages to fill in the missing information.
 * 
 * It updates existing records instead of creating new ones.
 * 
 * Usage:
 *   npx tsx yc_companies/re_scrape_missing_data.ts
 *   npx tsx yc_companies/re_scrape_missing_data.ts --limit=50  # Process only 50 startups
 *   npx tsx yc_companies/re_scrape_missing_data.ts --fields=founder_names,website  # Only fix specific fields
 *   npx tsx yc_companies/re_scrape_missing_data.ts --skip-email-discovery  # Skip email enrichment
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import puppeteer, { Browser, Page } from 'puppeteer';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { scrapeYCCompanyPage, extractCompanySlug } from './scrape_yc_companies';
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
  yc_link?: string | null;
  website?: string | null;
  founder_names?: string | null;
  founder_first_name?: string | null;
  founder_emails?: string | null;
  founder_linkedin?: string | null;
  location?: string | null;
  data_source?: string | null;
}

/**
 * Helper to check if a value is null or empty
 */
function isEmpty(value: any): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/**
 * Check if a startup is missing critical fields
 */
function isMissingCriticalFields(startup: StartupRecord): {
  missing: boolean;
  missingFields: string[];
  needsWebsite: boolean;
  needsFounderNames: boolean;
  needsFounderEmails: boolean;
} {
  const missingFields: string[] = [];
  let needsWebsite = false;
  let needsFounderNames = false;
  let needsFounderEmails = false;

  // Check website
  if (isEmpty(startup.website)) {
    missingFields.push('website');
    needsWebsite = true;
  }

  // Check founder names (check both founder_names and founder_first_name)
  if (isEmpty(startup.founder_names) && isEmpty(startup.founder_first_name)) {
    missingFields.push('founder_names');
    needsFounderNames = true;
  }

  // Check founder emails
  if (isEmpty(startup.founder_emails)) {
    missingFields.push('founder_emails');
    needsFounderEmails = true;
  }

  return {
    missing: missingFields.length > 0,
    missingFields,
    needsWebsite,
    needsFounderNames,
    needsFounderEmails,
  };
}

/**
 * Get startups missing critical fields
 */
async function getStartupsMissingData(
  limit?: number,
  fieldFilter?: string[]
): Promise<StartupRecord[]> {
  console.log('🔍 Finding startups missing critical data...\n');

  // Build query
  let query = supabase
    .from('startups')
    .select('id, name, yc_link, website, founder_names, founder_first_name, founder_emails, founder_linkedin, location, data_source')
    .eq('data_source', 'yc')
    .not('yc_link', 'is', null);

  // Apply field filters if specified
  if (fieldFilter) {
    if (fieldFilter.includes('website')) {
      query = query.or('website.is.null,website.eq.');
    }
    if (fieldFilter.includes('founder_names')) {
      query = query.or('founder_names.is.null,founder_names.eq.,founder_first_name.is.null,founder_first_name.eq.');
    }
    if (fieldFilter.includes('founder_emails')) {
      query = query.or('founder_emails.is.null,founder_emails.eq.');
    }
  } else {
    // Default: find startups missing any of the 3 critical fields
    query = query.or(
      'website.is.null,website.eq.,' +
      'founder_names.is.null,founder_names.eq.,' +
      'founder_first_name.is.null,founder_first_name.eq.,' +
      'founder_emails.is.null,founder_emails.eq.'
    );
  }

  if (limit) {
    query = query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching startups:', error);
    throw error;
  }

  // Filter to only those actually missing data
  const missing = (data || []).filter(startup => {
    const check = isMissingCriticalFields(startup);
    return check.missing;
  });

  return missing;
}

/**
 * Update startup with missing data from scraped page
 */
async function updateStartupWithScrapedData(
  startupId: string,
  pageData: any,
  skipEmailDiscovery: boolean = false
): Promise<{ updated: boolean; emailEnriched: boolean }> {
  try {
    const updates: any = {};
    let emailEnriched = false;

    // Helper to convert empty strings to null
    const toNull = (value: string | undefined): string | null => {
      return value && value.trim() ? value.trim() : null;
    };

    // Format founder names
    if (pageData.founders && pageData.founders.length > 0) {
      const founderNames = pageData.founders
        .map((f: any) => `${f.firstName} ${f.lastName}`.trim())
        .filter((name: string) => name.length > 0)
        .join(', ');

      const founderLinkedIns = pageData.founders
        .map((f: any) => f.linkedIn)
        .filter((linkedin: string) => linkedin && linkedin.length > 0)
        .join(', ');

      const firstFounder = pageData.founders[0];

      if (founderNames) {
        updates.founder_names = toNull(founderNames);
        updates.founder_first_name = toNull(firstFounder.firstName);
        updates.founder_last_name = toNull(firstFounder.lastName);
      }

      if (founderLinkedIns) {
        updates.founder_linkedin = toNull(founderLinkedIns);
      }
    }

    // Update website if missing
    if (pageData.website) {
      updates.website = toNull(pageData.website);
    }

    // Update location if available
    if (pageData.location) {
      updates.location = toNull(pageData.location);
    }

    // Discover founder emails if missing and we have founder names + website
    if (!skipEmailDiscovery && updates.founder_names && updates.website) {
      try {
        const founders = pageData.founders.map((f: any) => ({
          name: `${f.firstName} ${f.lastName}`.trim(),
          linkedin: f.linkedIn,
        }));

        const domain = updates.website.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
        
        if (domain) {
          console.log(`   📧 Discovering emails for founders @ ${domain}...`);
          const emailResult = await discoverFounderEmails(founders, domain, 2); // Try 2 patterns per founder

          if (emailResult.emailsFound > 0) {
            const emails = emailResult.founders
              .filter((f: any) => f.email)
              .map((f: any) => f.email)
              .join(', ');
            
            if (emails) {
              updates.founder_emails = emails;
              emailEnriched = true;
              console.log(`   ✅ Found ${emailResult.emailsFound} email(s)`);
            }
          }
        }
      } catch (emailError) {
        console.warn(`   ⚠️  Email discovery failed: ${emailError instanceof Error ? emailError.message : String(emailError)}`);
      }
    }

    // Only update if we have something to update
    if (Object.keys(updates).length === 0) {
      return { updated: false, emailEnriched: false };
    }

    // Update the startup
    const { error: updateError } = await supabase
      .from('startups')
      .update(updates)
      .eq('id', startupId);

    if (updateError) {
      console.error(`   ❌ Error updating startup: ${updateError.message}`);
      return { updated: false, emailEnriched: false };
    }

    return { updated: true, emailEnriched };
  } catch (error) {
    console.error(`   ❌ Error updating startup: ${error instanceof Error ? error.message : String(error)}`);
    return { updated: false, emailEnriched: false };
  }
}

/**
 * Main re-scraping function
 */
async function reScrapeMissingData() {
  console.log('🔄 Re-scraping Missing Data from YC Pages\n');

  // Get command line arguments
  const args = process.argv.slice(2);
  const limitArg = args.find(arg => arg.startsWith('--limit='))?.split('=')[1];
  const fieldsArg = args.find(arg => arg.startsWith('--fields='))?.split('=')[1];
  const skipEmailDiscovery = args.includes('--skip-email-discovery');

  const limit = limitArg ? parseInt(limitArg, 10) : undefined;
  const fieldFilter = fieldsArg ? fieldsArg.split(',').map(f => f.trim()) : undefined;

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

  // Get startups missing data
  const startups = await getStartupsMissingData(limit, fieldFilter);
  console.log(`📊 Found ${startups.length} startups missing critical data\n`);

  if (startups.length === 0) {
    console.log('✅ All startups have complete data!');
    return;
  }

  // Show summary of what's missing
  const missingCounts = {
    website: 0,
    founder_names: 0,
    founder_emails: 0,
  };

  startups.forEach(startup => {
    const check = isMissingCriticalFields(startup);
    if (check.needsWebsite) missingCounts.website++;
    if (check.needsFounderNames) missingCounts.founder_names++;
    if (check.needsFounderEmails) missingCounts.founder_emails++;
  });

  console.log('📋 Missing data breakdown:');
  console.log(`   Missing website: ${missingCounts.website}`);
  console.log(`   Missing founder names: ${missingCounts.founder_names}`);
  console.log(`   Missing founder emails: ${missingCounts.founder_emails}\n`);

  if (skipEmailDiscovery) {
    console.log('⚠️  Email discovery is disabled (--skip-email-discovery)\n');
  }

  // Launch browser
  console.log('🌐 Launching browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  let successCount = 0;
  let updatedCount = 0;
  let emailEnrichedCount = 0;
  let errorCount = 0;

  try {
    for (let i = 0; i < startups.length; i++) {
      const startup = startups[i];
      const check = isMissingCriticalFields(startup);

      console.log(`\n[${i + 1}/${startups.length}] 🏢 Processing: ${startup.name}`);
      console.log(`   Missing: ${check.missingFields.join(', ')}`);

      if (!startup.yc_link) {
        console.log('   ⚠️  No YC link, skipping...');
        errorCount++;
        continue;
      }

      try {
        // Scrape YC page
        console.log(`   🔍 Scraping: ${startup.yc_link}`);
        const pageData = await scrapeYCCompanyPage(page, startup.yc_link);

        if (!pageData) {
          console.log('   ❌ Failed to scrape page data');
          errorCount++;
          continue;
        }

        // Show what we found
        console.log(`   Found ${pageData.founders.length} founder(s)`);
        if (pageData.website) {
          console.log(`   Website: ${pageData.website}`);
        }

        // Update startup with scraped data
        const result = await updateStartupWithScrapedData(
          startup.id,
          pageData,
          skipEmailDiscovery
        );

        if (result.updated) {
          updatedCount++;
          console.log('   ✅ Updated database');
          
          if (result.emailEnriched) {
            emailEnrichedCount++;
          }
        } else {
          console.log('   ℹ️  No new data to update');
        }

        successCount++;

        // Rate limiting
        if (i < startups.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
        }

      } catch (error) {
        errorCount++;
        console.error(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    await browser.close();
    console.log('\n🌐 Browser closed');
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Re-scraping Complete');
  console.log('='.repeat(60));
  console.log(`Total processed: ${startups.length}`);
  console.log(`Successfully scraped: ${successCount}`);
  console.log(`Updated in database: ${updatedCount}`);
  console.log(`Emails enriched: ${emailEnrichedCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log('='.repeat(60));
}

// Run the script
if (require.main === module) {
  reScrapeMissingData()
    .then(() => {
      console.log('\n✅ Process completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Process failed:', error);
      process.exit(1);
    });
}

export { reScrapeMissingData, getStartupsMissingData, isMissingCriticalFields };

