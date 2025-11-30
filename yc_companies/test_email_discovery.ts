/**
 * Test Script for Pattern-Based Email Discovery
 *
 * This script tests pattern matching email discovery on companies from the database.
 * Simplified approach: no web scraping, only pattern matching + verification.
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@supabase/supabase-js';
import { discoverFounderEmails } from './founder_email_discovery';

// Initialize Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase credentials');
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface TestResult {
  companyName: string;
  website: string;
  foundersFound: number;
  emailsFound: number;
  primaryFounder: string;
  primaryEmail: string;
  success: boolean;
  errorMessage?: string;
}

/**
 * Get test companies from database with founder names
 */
async function getTestCompanies(limit: number = 10): Promise<any[]> {
  console.log(`📊 Fetching ${limit} test companies from database...\n`);

  const { data, error } = await supabase
    .from('startups')
    .select('id, name, website, founder_names, data_source, created_at')
    .eq('data_source', 'techcrunch')
    .not('founder_names', 'is', null)
    .not('founder_names', 'eq', '')
    .not('website', 'is', null)
    .not('website', 'eq', '')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) {
    console.warn('⚠️  No TechCrunch companies with founder names found in database.');
    console.warn('   Run the TechCrunch scraper first: npm run scrape-techcrunch\n');
    throw new Error('No test companies available');
  }

  console.log(`✅ Found ${data.length} companies for testing:\n`);
  data.forEach((company, i) => {
    const founders = company.founder_names ? company.founder_names.split(',').map((f: string) => f.trim()) : [];
    console.log(`   ${i + 1}. ${company.name} (${founders.length} founders, ${company.website})`);
  });
  console.log('');

  return data;
}

/**
 * Parse founder names from CSV string
 */
function parseFounderNames(founderNamesCSV: string | null): Array<{ name: string }> {
  if (!founderNamesCSV) return [];

  return founderNamesCSV
    .split(',')
    .map(name => name.trim())
    .filter(name => name.length > 0)
    .map(name => ({ name }));
}

/**
 * Test email discovery on a single company
 */
async function testCompany(company: any): Promise<TestResult> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Testing: ${company.name}`);
  console.log(`Website: ${company.website || 'N/A'}`);
  console.log(`Founders: ${company.founder_names || 'N/A'}`);
  console.log(`${'='.repeat(80)}\n`);

  const result: TestResult = {
    companyName: company.name,
    website: company.website || '',
    foundersFound: 0,
    emailsFound: 0,
    primaryFounder: '',
    primaryEmail: '',
    success: false,
  };

  try {
    // Parse founder names
    const founders = parseFounderNames(company.founder_names);

    if (founders.length === 0) {
      throw new Error('No founder names available');
    }

    if (!company.website) {
      throw new Error('No website available');
    }

    // Extract domain from website
    const domain = company.website
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .toLowerCase();

    console.log(`  📧 Pattern matching ${founders.length} founders @ ${domain}...\n`);

    // Run email discovery
    const discoveryResult = await discoverFounderEmails(founders, domain);

    result.foundersFound = discoveryResult.totalFound;
    result.emailsFound = discoveryResult.emailsFound;

    if (discoveryResult.primaryFounder) {
      result.primaryFounder = discoveryResult.primaryFounder.name;
      result.primaryEmail = discoveryResult.primaryFounder.email || '';
    }

    result.success = result.emailsFound > 0;

    // Log results
    console.log(`\n📊 Results:`);
    console.log(`   Founders tested: ${result.foundersFound}`);
    console.log(`   Emails found: ${result.emailsFound}`);

    if (result.primaryFounder) {
      console.log(`   Primary founder: ${result.primaryFounder}`);
      console.log(`   Primary email: ${result.primaryEmail || 'N/A'}`);
    }

    // Show all founders
    if (discoveryResult.founders.length > 0) {
      console.log(`\n   All founders:`);
      discoveryResult.founders.forEach((founder, i) => {
        const emailStatus = founder.email ? `✅ ${founder.email}` : '❌ No email';
        const confidence = founder.confidence ? ` [${(founder.confidence * 100).toFixed(0)}%]` : '';
        console.log(`      ${i + 1}. ${founder.name} - ${emailStatus}${confidence}`);
      });
    }

    if (result.success) {
      console.log(`\n✅ SUCCESS: Found ${result.emailsFound} founder email(s)`);
    } else {
      console.log(`\n⚠️  NO EMAILS FOUND: Will need manual Hunter.io lookup`);
    }

  } catch (error) {
    result.errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ ERROR: ${result.errorMessage}`);
  }

  return result;
}

/**
 * Calculate and display statistics
 */
function displayStatistics(results: TestResult[]) {
  console.log(`\n\n${'='.repeat(80)}`);
  console.log(`TEST RESULTS SUMMARY`);
  console.log(`${'='.repeat(80)}\n`);

  const totalCompanies = results.length;
  const successfulCompanies = results.filter(r => r.success).length;
  const failedCompanies = results.filter(r => !r.success).length;
  const erroredCompanies = results.filter(r => r.errorMessage).length;

  const totalEmails = results.reduce((sum, r) => sum + r.emailsFound, 0);
  const totalFounders = results.reduce((sum, r) => sum + r.foundersFound, 0);

  console.log(`📊 Overall Statistics:`);
  console.log(`   Total companies tested: ${totalCompanies}`);
  console.log(`   Companies with emails: ${successfulCompanies} (${(successfulCompanies / totalCompanies * 100).toFixed(1)}%)`);
  console.log(`   Companies without emails: ${failedCompanies} (${(failedCompanies / totalCompanies * 100).toFixed(1)}%)`);
  console.log(`   Errors encountered: ${erroredCompanies}`);
  console.log(`   Total founders tested: ${totalFounders}`);
  console.log(`   Total emails found: ${totalEmails}`);
  console.log(`   Avg emails per company: ${(totalEmails / totalCompanies).toFixed(1)}`);

  // Success criteria check
  console.log(`\n✅ Success Criteria:`);
  const targetSuccessRate = 60;
  const actualSuccessRate = (successfulCompanies / totalCompanies * 100);
  const meetsTarget = actualSuccessRate >= targetSuccessRate;

  console.log(`   Target: ${targetSuccessRate}% success rate`);
  console.log(`   Actual: ${actualSuccessRate.toFixed(1)}%`);
  console.log(`   Status: ${meetsTarget ? '✅ PASSED' : '❌ FAILED'}`);

  // List companies that need manual Hunter.io lookup
  const needsManualLookup = results.filter(r => !r.success && !r.errorMessage);
  if (needsManualLookup.length > 0) {
    console.log(`\n⚠️  Companies needing manual Hunter.io lookup (${needsManualLookup.length}):`);
    needsManualLookup.forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.companyName} (${r.website || 'no website'})`);
    });
  }

  // List errors
  const errored = results.filter(r => r.errorMessage);
  if (errored.length > 0) {
    console.log(`\n❌ Companies with errors (${errored.length}):`);
    errored.forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.companyName}: ${r.errorMessage}`);
    });
  }

  console.log(`\n${'='.repeat(80)}\n`);
}

/**
 * Export results to JSON for analysis
 */
async function exportResults(results: TestResult[]) {
  const fs = await import('fs/promises');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `test-results-${timestamp}.json`;
  const filepath = resolve(process.cwd(), 'yc_companies', filename);

  await fs.writeFile(filepath, JSON.stringify(results, null, 2));
  console.log(`📁 Results exported to: ${filename}\n`);
}

/**
 * Main test function
 */
async function runTests() {
  console.log('🧪 Pattern-Based Email Discovery Testing\n');
  console.log('This tests pattern matching + verification (no web scraping).\n');

  try {
    // Get test companies
    const testLimit = parseInt(process.env.TEST_LIMIT || '10');
    const companies = await getTestCompanies(testLimit);

    // Test each company
    const results: TestResult[] = [];
    for (let i = 0; i < companies.length; i++) {
      const company = companies[i];
      const result = await testCompany(company);
      results.push(result);

      // Small delay between companies to avoid hitting API rate limits
      if (i < companies.length - 1) {
        console.log(`\n⏳ Waiting 2 seconds before next company...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Display statistics
    displayStatistics(results);

    // Export results
    await exportResults(results);

    // Final summary
    const successRate = (results.filter(r => r.success).length / results.length * 100);
    if (successRate >= 75) {
      console.log('✅ Pattern matching is performing excellently!\n');
    } else if (successRate >= 60) {
      console.log('✅ Pattern matching meets success criteria.\n');
    } else {
      console.log('⚠️  Lower than expected success rate. May need to manually use Hunter.io for remaining companies.\n');
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run tests
if (require.main === module) {
  runTests()
    .then(() => {
      console.log('✅ Testing complete!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Testing failed:', error);
      process.exit(1);
    });
}

export { runTests, testCompany, getTestCompanies };
