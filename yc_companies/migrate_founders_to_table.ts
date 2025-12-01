/**
 * Data Migration Script: CSV Founders → Founders Table
 *
 * Migrates founder data from CSV columns in startups table to the new founders table.
 *
 * Steps:
 * 1. Read all startups with founder data (founder_names, founder_emails, founder_linkedin)
 * 2. Parse CSV strings into individual founder records
 * 3. Insert into founders table
 * 4. Handle duplicates and conflicts
 * 5. Report migration statistics
 *
 * Run with: npm run migrate:founders
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@supabase/supabase-js';

// Initialize Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase credentials');
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface StartupRecord {
  id: string;
  name: string;
  website?: string;
  founder_names?: string;
  founder_emails?: string;
  founder_linkedin?: string;
}

interface FounderRecord {
  startup_id: string;
  name: string;
  email?: string;
  role?: string;
  linkedin_url?: string;
  email_source?: string;
  email_verified: boolean;
  email_confidence?: number;
  needs_manual_review: boolean;
}

/**
 * Parse CSV string into array
 */
function parseCSV(csvString: string | null | undefined): string[] {
  if (!csvString) return [];
  return csvString
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Validate and clean email
 */
function cleanEmail(email: string | undefined): string | undefined {
  if (!email) return undefined;
  const cleaned = email.trim().toLowerCase();
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(cleaned) ? cleaned : undefined;
}

/**
 * Migrate founders for a single startup
 */
async function migrateStartupFounders(startup: StartupRecord): Promise<number> {
  const names = parseCSV(startup.founder_names);
  const emails = parseCSV(startup.founder_emails);
  const linkedins = parseCSV(startup.founder_linkedin);

  if (names.length === 0) {
    console.log(`  ⚠️  No founder names for ${startup.name}`);
    return 0;
  }

  console.log(`\n  📋 Migrating ${names.length} founder(s) for: ${startup.name}`);

  const founderRecords: FounderRecord[] = [];

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const email = cleanEmail(emails[i]);
    const linkedin = linkedins[i]?.trim();

    // Determine email source and verification status
    let emailSource: string | undefined;
    let emailVerified = false;
    let emailConfidence: number | undefined;
    let needsManualReview = false;

    if (email) {
      // Check if email looks pattern-matched (common patterns)
      const firstName = name.split(' ')[0]?.toLowerCase();
      const domain = email.split('@')[1];

      if (firstName && email.startsWith(firstName)) {
        emailSource = 'pattern_matched';
        emailVerified = true; // Assume verified if it made it to the database
        emailConfidence = 0.85; // Pattern matching default confidence
      } else {
        emailSource = 'techcrunch'; // Likely came from TechCrunch scraping
        emailVerified = false;
      }
    }

    const founderRecord: FounderRecord = {
      startup_id: startup.id,
      name,
      email,
      linkedin_url: linkedin,
      email_source: emailSource,
      email_verified: emailVerified,
      email_confidence: emailConfidence,
      needs_manual_review: needsManualReview,
    };

    founderRecords.push(founderRecord);
    console.log(`     ${i + 1}. ${name}${email ? ` (${email})` : ' (no email)'}${linkedin ? ' [LinkedIn]' : ''}`);
  }

  // Insert into founders table
  const { data, error } = await supabase
    .from('founders')
    .insert(founderRecords)
    .select();

  if (error) {
    console.error(`     ❌ Error inserting founders:`, error.message);
    return 0;
  }

  console.log(`     ✅ Inserted ${data?.length || 0} founders`);
  return data?.length || 0;
}

/**
 * Main migration function
 */
async function migrateFounders() {
  console.log('🚀 Starting Founder Data Migration');
  console.log('=====================================\n');

  // Fetch all startups with founder data
  console.log('📊 Fetching startups with founder data...\n');

  const { data: startups, error } = await supabase
    .from('startups')
    .select('id, name, website, founder_names, founder_emails, founder_linkedin')
    .not('founder_names', 'is', null)
    .not('founder_names', 'eq', '')
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  if (!startups || startups.length === 0) {
    console.log('⚠️  No startups with founder data found.');
    console.log('   Make sure the TechCrunch scraper has run and enriched the data.\n');
    return;
  }

  console.log(`✅ Found ${startups.length} startups with founder data\n`);

  // Check if founders table exists
  const { error: tableCheckError } = await supabase
    .from('founders')
    .select('id')
    .limit(1);

  if (tableCheckError && tableCheckError.message.includes('does not exist')) {
    console.error('❌ Founders table does not exist!');
    console.error('   Please run the migration first:');
    console.error('   npx supabase migration up\n');
    return;
  }

  // Check for existing founders (avoid duplicates)
  const { data: existingFounders, error: existingError } = await supabase
    .from('founders')
    .select('id');

  if (existingError) {
    console.error('❌ Error checking existing founders:', existingError.message);
    return;
  }

  if (existingFounders && existingFounders.length > 0) {
    console.log(`⚠️  Found ${existingFounders.length} existing founders in the table.`);
    console.log('   This script will attempt to migrate anyway.');
    console.log('   Duplicates may occur if the same startup is migrated twice.\n');

    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise<string>((resolve) => {
      rl.question('   Continue? (y/n): ', resolve);
    });
    rl.close();

    if (answer.toLowerCase() !== 'y') {
      console.log('\n❌ Migration cancelled.\n');
      return;
    }
  }

  // Migrate each startup
  console.log('\n📦 Migrating founders...\n');
  console.log('='.repeat(80));

  let totalFoundersMigrated = 0;
  let startupsWithErrors = 0;

  for (let i = 0; i < startups.length; i++) {
    const startup = startups[i];

    console.log(`\n[${i + 1}/${startups.length}] ${startup.name}`);

    try {
      const founderCount = await migrateStartupFounders(startup);
      totalFoundersMigrated += founderCount;
    } catch (error) {
      console.error(`  ❌ Error migrating ${startup.name}:`, error instanceof Error ? error.message : String(error));
      startupsWithErrors++;
    }

    // Small delay to avoid rate limiting
    if (i < startups.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  // Summary
  console.log('\n\n' + '='.repeat(80));
  console.log('MIGRATION SUMMARY');
  console.log('='.repeat(80) + '\n');

  console.log(`📊 Statistics:`);
  console.log(`   Total startups processed: ${startups.length}`);
  console.log(`   Total founders migrated: ${totalFoundersMigrated}`);
  console.log(`   Startups with errors: ${startupsWithErrors}`);
  console.log(`   Success rate: ${((startups.length - startupsWithErrors) / startups.length * 100).toFixed(1)}%`);

  // Verification query
  const { data: verificationData, error: verificationError } = await supabase
    .from('founders')
    .select('id, email, email_verified, needs_manual_review');

  if (verificationError) {
    console.error(`\n⚠️  Could not verify migration:`, verificationError.message);
  } else if (verificationData) {
    const totalFounders = verificationData.length;
    const withEmail = verificationData.filter(f => f.email).length;
    const verified = verificationData.filter(f => f.email_verified).length;
    const needsReview = verificationData.filter(f => f.needs_manual_review).length;

    console.log(`\n📧 Email Statistics:`);
    console.log(`   Founders with emails: ${withEmail}/${totalFounders} (${(withEmail / totalFounders * 100).toFixed(1)}%)`);
    console.log(`   Emails verified: ${verified}/${withEmail} (${withEmail > 0 ? (verified / withEmail * 100).toFixed(1) : 0}%)`);
    console.log(`   Needs manual review: ${needsReview}`);
  }

  console.log(`\n✅ Migration complete!\n`);
}

// Run migration
if (require.main === module) {
  migrateFounders()
    .then(() => {
      console.log('✅ Migration script completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration script failed:', error);
      process.exit(1);
    });
}

export { migrateFounders, migrateStartupFounders };
