/**
 * Bulk mark startups for re-enrichment based on placeholder/incomplete data
 * 
 * This script identifies startups with placeholder or incomplete data and marks
 * them for re-enrichment. It checks for:
 * - Placeholder founder names ("Team")
 * - Placeholder emails ("hello@domain.com")
 * - Missing founder LinkedIn
 * - Placeholder funding amounts ("$1.5M")
 * - Missing tech stack, founder backgrounds, website keywords
 * 
 * Usage:
 *   npm run enrich:mark          # Shows what would be marked (requires confirmation)
 *   npm run enrich:mark:auto     # Automatically marks without confirmation
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
  tech_stack?: string | null;
  founder_backgrounds?: string | null;
  website_keywords?: string | null;
  enrichment_status?: string | null;
  needs_enrichment?: boolean | null;
  [key: string]: any;
}

/**
 * Check if a value is null or empty (after normalization, placeholders should be NULL)
 */
function isEmptyOrNull(value: any): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/**
 * Check if a startup needs re-enrichment
 * 
 * NOTE: This assumes placeholder values have been normalized to NULL first.
 * Run normalize_placeholder_values.ts before using this script.
 */
function needsReEnrichment(startup: StartupRecord): {
  needsIt: boolean;
  reasons: string[];
  priority: 'high' | 'medium' | 'low';
} {
  const reasons: string[] = [];
  let missingCriticalFields = 0;
  let missingImportantFields = 0;
  
  // Critical fields (founder info, funding)
  // After normalization, placeholders should be NULL, so we just check for NULL/empty
  if (isEmptyOrNull(startup.founder_names)) {
    reasons.push('missing founder_names');
    missingCriticalFields++;
  }
  
  if (isEmptyOrNull(startup.founder_emails)) {
    reasons.push('missing founder_emails');
    missingCriticalFields++;
  }
  
  if (isEmptyOrNull(startup.founder_linkedin)) {
    reasons.push('missing founder_linkedin');
    missingImportantFields++;
  }
  
  // Check funding - missing funding amount is critical
  if (isEmptyOrNull(startup.funding_amount)) {
    reasons.push('missing funding_amount');
    missingCriticalFields++;
  }
  
  // If funding amount is missing, funding stage is also suspect
  if (isEmptyOrNull(startup.funding_amount) && isEmptyOrNull(startup.round_type)) {
    reasons.push('missing funding_stage');
  }
  
  // Important fields (enrichment data) - these are nice to have but not critical
  if (isEmptyOrNull(startup.tech_stack)) {
    reasons.push('missing tech_stack');
    missingImportantFields++;
  }
  
  if (isEmptyOrNull(startup.founder_backgrounds)) {
    reasons.push('missing founder_backgrounds');
    missingImportantFields++;
  }
  
  if (isEmptyOrNull(startup.website_keywords)) {
    reasons.push('missing website_keywords');
    missingImportantFields++;
  }
  
  // Determine priority
  let priority: 'high' | 'medium' | 'low' = 'low';
  if (missingCriticalFields >= 2) {
    priority = 'high';
  } else if (missingCriticalFields >= 1 || missingImportantFields >= 3) {
    priority = 'medium';
  } else if (missingImportantFields >= 2) {
    priority = 'low';
  }
  
  // Need at least 2 missing fields (or 1 critical field) to require re-enrichment
  const needsIt = missingCriticalFields >= 1 || (missingCriticalFields + missingImportantFields) >= 2;
  
  return {
    needsIt,
    reasons,
    priority
  };
}

/**
 * Main function to mark startups for re-enrichment
 * 
 * IMPORTANT: Run normalize_placeholder_values.ts first to convert placeholders to NULL!
 */
async function markStartupsForReEnrichment() {
  console.log('🔍 Identifying startups that need re-enrichment...\n');
  console.log('⚠️  NOTE: Make sure you\'ve run normalize_placeholder_values.ts first!\n');
  
  // Get all startups
  const { data: startups, error } = await supabase
    .from('startups')
    .select('*');
  
  if (error) {
    throw error;
  }
  
  if (!startups || startups.length === 0) {
    console.log('❌ No startups found');
    return;
  }
  
  console.log(`📊 Found ${startups.length} total startups\n`);
  
  // Identify which need re-enrichment
  const needsReEnrichmentList: Array<{ 
    startup: StartupRecord; 
    reasons: string[];
    priority: 'high' | 'medium' | 'low';
  }> = [];
  
  const priorityCounts = { high: 0, medium: 0, low: 0 };
  
  for (const startup of startups) {
    const result = needsReEnrichment(startup as StartupRecord);
    if (result.needsIt) {
      needsReEnrichmentList.push({
        startup: startup as StartupRecord,
        reasons: result.reasons,
        priority: result.priority
      });
      priorityCounts[result.priority]++;
    }
  }
  
  // Sort by priority (high first)
  needsReEnrichmentList.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
  
  console.log(`⚠️  Found ${needsReEnrichmentList.length} startups needing re-enrichment\n`);
  console.log(`   Priority breakdown:`);
  console.log(`   🔴 High priority: ${priorityCounts.high}`);
  console.log(`   🟡 Medium priority: ${priorityCounts.medium}`);
  console.log(`   🟢 Low priority: ${priorityCounts.low}\n`);
  
  // Show sample
  console.log('Sample startups needing re-enrichment:');
  for (let i = 0; i < Math.min(10, needsReEnrichmentList.length); i++) {
    const { startup, reasons, priority } = needsReEnrichmentList[i];
    const priorityEmoji = priority === 'high' ? '🔴' : priority === 'medium' ? '🟡' : '🟢';
    console.log(`\n  ${i + 1}. ${priorityEmoji} ${startup.name}`);
    console.log(`     Reasons: ${reasons.join(', ')}`);
  }
  
  if (needsReEnrichmentList.length > 10) {
    console.log(`\n  ... and ${needsReEnrichmentList.length - 10} more`);
  }
  
  // Check if auto mode
  const shouldMark = process.argv.includes('--auto') || 
                     process.argv.includes('--yes') ||
                     process.argv.includes('-y');
  
  if (!shouldMark) {
    console.log(`\n⚠️  This will mark ${needsReEnrichmentList.length} startups for re-enrichment.`);
    console.log('   Run with --auto flag to skip confirmation: npm run enrich:mark:auto');
    return;
  }
  
  // Mark for re-enrichment
  console.log(`\n🔄 Marking ${needsReEnrichmentList.length} startups for re-enrichment...\n`);
  
  const idsToUpdate = needsReEnrichmentList.map(({ startup }) => startup.id);
  
  // Update in batches of 100
  const batchSize = 100;
  let updated = 0;
  
  for (let i = 0; i < idsToUpdate.length; i += batchSize) {
    const batch = idsToUpdate.slice(i, i + batchSize);
    
    const { error: updateError } = await supabase
      .from('startups')
      .update({
        needs_enrichment: true,
        enrichment_status: 'pending'
      })
      .in('id', batch);
    
    if (updateError) {
      console.error(`❌ Error updating batch ${Math.floor(i / batchSize) + 1}:`, updateError);
    } else {
      updated += batch.length;
      const percent = ((updated / needsReEnrichmentList.length) * 100).toFixed(1);
      console.log(`   ✅ Marked ${updated}/${needsReEnrichmentList.length} startups (${percent}%)`);
    }
  }
  
  console.log(`\n✅ Successfully marked ${updated} startups for re-enrichment!`);
  console.log(`\n💡 Next steps:`);
  console.log(`   1. Run enrichment: npm run enrich-startups [limit]`);
  console.log(`   2. Or process in batches: npm run enrich-startups 50`);
  console.log(`   3. Example: npm run enrich-startups 100`);
}

// Run if called directly
if (require.main === module) {
  markStartupsForReEnrichment()
    .then(() => {
      console.log('\n✅ Done!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Error:', error);
      process.exit(1);
    });
}

export { markStartupsForReEnrichment };

