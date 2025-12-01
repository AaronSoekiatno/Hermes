/**
 * Normalize placeholder/default values to NULL in the database
 * 
 * This script identifies placeholder values (like "Team", "$1.5M", "hello@domain.com")
 * and sets them to NULL so we can properly distinguish between:
 * - Missing data (NULL) - needs enrichment
 * - Real data - already enriched
 * 
 * This should be run BEFORE marking startups for re-enrichment.
 * 
 * Usage:
 *   npm run normalize:placeholders          # Shows what would be normalized (dry run)
 *   npm run normalize:placeholders:auto     # Actually normalizes the values
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey);

interface StartupRecord {
  id: string;
  name: string;
  founder_names?: string | null;
  founder_emails?: string | null;
  founder_linkedin?: string | null;
  funding_amount?: string | null;
  round_type?: string | null;
  website?: string | null;
  [key: string]: any;
}

/**
 * Normalize a company name to create expected default website pattern
 */
function normalizeCompanyNameForWebsite(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '')           // Remove spaces
    .replace(/-/g, '')              // Remove hyphens
    .replace(/_/g, '')              // Remove underscores
    .replace(/\./g, '');            // Remove dots
}

/**
 * Check if a website matches the default pattern of company name + domain
 * This detects when website was auto-generated from company name instead of found
 */
function isDefaultWebsitePattern(website: string, companyName: string): boolean {
  if (!website || !companyName) return false;
  
  const normalizedName = normalizeCompanyNameForWebsite(companyName);
  const websiteLower = website.toLowerCase().trim();
  
  // Remove protocol if present
  let domainOnly = websiteLower.replace(/^https?:\/\//, '').replace(/^www\./, '');
  
  // Extract domain without TLD
  const domainMatch = domainOnly.match(/^([^.]+)/);
  if (!domainMatch) return false;
  
  const domainBase = domainMatch[1];
  
  // Check if domain matches normalized company name exactly
  if (domainBase === normalizedName) {
    return true;
  }
  
  // Check common TLD patterns that might still be defaults
  // If it's exactly name.com, name.ai, name.io, etc., it's likely a default
  const commonTlds = ['.com', '.ai', '.io', '.dev', '.app', '.co', '.org'];
  for (const tld of commonTlds) {
    if (domainOnly === normalizedName + tld) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if a value is a placeholder that should be normalized to NULL
 */
function isPlaceholder(value: any, field: string, companyName?: string): boolean {
  if (!value || typeof value !== 'string') return false;
  const lower = value.toLowerCase().trim();
  
  // Founder names placeholders
  if (field === 'founder_names' && 
      (lower === 'team' || lower === 'founder' || lower === 'n/a')) {
    return true;
  }
  
  // Founder emails placeholders
  if (field === 'founder_emails' && 
      (lower.startsWith('hello@') || 
       lower.includes('example.com') || 
       lower.includes('test.com'))) {
    return true;
  }
  
  // Funding amount placeholders
  if (field === 'funding_amount' && 
      (lower === '$1.5m' || lower === '$1.5 m' || lower === '1.5m' || lower === '1.5 m')) {
    return true;
  }
  
  // Website placeholders - check if it matches default name pattern
  if (field === 'website') {
    // Generic placeholders
    if (!lower.includes('.') || 
        lower === 'website.com' || 
        lower === 'example.com') {
      return true;
    }
    
    // Check if website matches company name pattern (likely auto-generated default)
    if (companyName && isDefaultWebsitePattern(value, companyName)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if a funding amount is a placeholder
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
  ];
  
  return placeholderAmounts.includes(trimmed);
}

/**
 * Analyze startups and identify placeholder values that should be normalized
 */
async function analyzePlaceholders(): Promise<{
  startupsWithPlaceholders: Array<{
    id: string;
    name: string;
    fieldsToNormalize: Array<{ field: string; currentValue: string }>;
  }>;
  summary: {
    total: number;
    withPlaceholders: number;
    fieldCounts: Record<string, number>;
  };
}> {
  console.log('🔍 Analyzing startups for placeholder values...\n');
  
  // Get all startups
  const { data: startups, error } = await supabase
    .from('startups')
    .select('*');
  
  if (error) {
    throw error;
  }
  
  if (!startups || startups.length === 0) {
    console.log('❌ No startups found');
    return { startupsWithPlaceholders: [], summary: { total: 0, withPlaceholders: 0, fieldCounts: {} } };
  }
  
  console.log(`📊 Found ${startups.length} total startups\n`);
  
  const startupsWithPlaceholders: Array<{
    id: string;
    name: string;
    fieldsToNormalize: Array<{ field: string; currentValue: string }>;
  }> = [];
  
  const fieldCounts: Record<string, number> = {};
  
  for (const startup of startups as StartupRecord[]) {
    const fieldsToNormalize: Array<{ field: string; currentValue: string }> = [];
    
    // Check each field
    if (startup.founder_names && isPlaceholder(startup.founder_names, 'founder_names')) {
      fieldsToNormalize.push({ field: 'founder_names', currentValue: startup.founder_names });
      fieldCounts['founder_names'] = (fieldCounts['founder_names'] || 0) + 1;
    }
    
    if (startup.founder_emails && isPlaceholder(startup.founder_emails, 'founder_emails')) {
      fieldsToNormalize.push({ field: 'founder_emails', currentValue: startup.founder_emails });
      fieldCounts['founder_emails'] = (fieldCounts['founder_emails'] || 0) + 1;
    }
    
    // Check website - need to pass company name to detect default pattern
    if (startup.website && isPlaceholder(startup.website, 'website', startup.name)) {
      fieldsToNormalize.push({ field: 'website', currentValue: startup.website });
      fieldCounts['website'] = (fieldCounts['website'] || 0) + 1;
    }
    
    if (startup.funding_amount && isPlaceholderFundingAmount(startup.funding_amount)) {
      fieldsToNormalize.push({ field: 'funding_amount', currentValue: startup.funding_amount });
      fieldCounts['funding_amount'] = (fieldCounts['funding_amount'] || 0) + 1;
    }
    
    // Check funding stage - if funding amount is placeholder and stage is "Seed", normalize stage too
    if (startup.funding_amount && isPlaceholderFundingAmount(startup.funding_amount)) {
      if (startup.round_type && startup.round_type.toLowerCase().trim() === 'seed') {
        // Only normalize if funding amount is also placeholder (suspicious combo)
        if (!fieldsToNormalize.find(f => f.field === 'round_type')) {
          fieldsToNormalize.push({ field: 'round_type', currentValue: startup.round_type });
          fieldCounts['round_type'] = (fieldCounts['round_type'] || 0) + 1;
        }
      }
    }
    
    if (fieldsToNormalize.length > 0) {
      startupsWithPlaceholders.push({
        id: startup.id,
        name: startup.name,
        fieldsToNormalize
      });
    }
  }
  
  return {
    startupsWithPlaceholders,
    summary: {
      total: startups.length,
      withPlaceholders: startupsWithPlaceholders.length,
      fieldCounts
    }
  };
}

/**
 * Normalize placeholder values to NULL
 */
async function normalizePlaceholders() {
  const { startupsWithPlaceholders, summary } = await analyzePlaceholders();
  
  console.log(`\n📋 Summary:`);
  console.log(`   Total startups: ${summary.total}`);
  console.log(`   Startups with placeholders: ${summary.withPlaceholders}`);
  console.log(`\n   Fields to normalize:`);
  Object.entries(summary.fieldCounts).forEach(([field, count]) => {
    console.log(`     - ${field}: ${count} startups`);
  });
  
  if (startupsWithPlaceholders.length === 0) {
    console.log('\n✅ No placeholder values found!');
    return;
  }
  
  // Show sample
  console.log('\n📝 Sample startups with placeholders:');
  for (let i = 0; i < Math.min(10, startupsWithPlaceholders.length); i++) {
    const { name, fieldsToNormalize } = startupsWithPlaceholders[i];
    console.log(`\n  ${i + 1}. ${name}`);
    fieldsToNormalize.forEach(({ field, currentValue }) => {
      console.log(`     - ${field}: "${currentValue}" → NULL`);
    });
  }
  
  if (startupsWithPlaceholders.length > 10) {
    console.log(`\n  ... and ${startupsWithPlaceholders.length - 10} more`);
  }
  
  // Check if auto mode
  const shouldNormalize = process.argv.includes('--auto') || 
                          process.argv.includes('--yes') ||
                          process.argv.includes('-y');
  
  if (!shouldNormalize) {
    console.log(`\n⚠️  This will normalize ${startupsWithPlaceholders.length} startups (set placeholder values to NULL).`);
    console.log('   Run with --auto flag to proceed: npm run normalize:placeholders:auto');
    return;
  }
  
  // Normalize in batches
  console.log(`\n🔄 Normalizing placeholder values to NULL...\n`);
  
  let updated = 0;
  const batchSize = 50;
  
  for (const { id, fieldsToNormalize } of startupsWithPlaceholders) {
    const updates: Record<string, null> = {};
    fieldsToNormalize.forEach(({ field }) => {
      updates[field] = null;
    });
    
    const { error } = await supabase
      .from('startups')
      .update(updates)
      .eq('id', id);
    
    if (error) {
      console.error(`  ❌ Error updating ${id}:`, error);
    } else {
      updated++;
      if (updated % 10 === 0) {
        console.log(`  ✅ Normalized ${updated}/${startupsWithPlaceholders.length} startups`);
      }
    }
    
    // Small delay to avoid overwhelming the database
    if (updated % batchSize === 0) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  console.log(`\n✅ Successfully normalized ${updated} startups!`);
  console.log(`\n💡 Next steps:`);
  console.log(`   1. Run mark script: npm run enrich:mark:auto`);
  console.log(`   2. Then enrich: npm run enrich-startups [limit]`);
}

// Run if called directly
if (require.main === module) {
  normalizePlaceholders()
    .then(() => {
      console.log('\n✅ Done!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Error:', error);
      process.exit(1);
    });
}

export { normalizePlaceholders, analyzePlaceholders };

