/**
 * Test script for YC company scraper
 * 
 * Tests the enhanced scraper with:
 * - Founder extraction with descriptions
 * - Jobs page scraping
 * - Better selector matching
 * 
 * Usage:
 *   npm run test:scrape-yc [--url=https://www.ycombinator.com/companies/the-interface]
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import puppeteer from 'puppeteer';
import { scrapeYCCompanyPage } from './scrape_yc_companies';

// Test URLs - can be overridden via command line
const DEFAULT_TEST_URL = 'https://www.ycombinator.com/companies/the-interface';

interface TestResult {
  url: string;
  success: boolean;
  data: {
    founders: number;
    foundersWithDescriptions: number;
    website: boolean;
    teamSize: boolean;
    jobs: number;
    jobsWithLocations: number;
    location: boolean;
    summary: boolean;
  };
  errors: string[];
  rawData?: any;
}

/**
 * Run a single test
 */
async function testScrapeCompany(url: string): Promise<TestResult> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🧪 Testing: ${url}`);
  console.log('='.repeat(60));

  const result: TestResult = {
    url,
    success: false,
    data: {
      founders: 0,
      foundersWithDescriptions: 0,
      website: false,
      teamSize: false,
      jobs: 0,
      jobsWithLocations: 0,
      location: false,
      summary: false,
    },
    errors: [],
  };

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const pageData = await scrapeYCCompanyPage(page, url);

    if (!pageData) {
      result.errors.push('Failed to scrape page data');
      return result;
    }

    result.rawData = pageData;
    result.success = true;

    // Analyze results
    result.data.founders = pageData.founders.length;
    result.data.foundersWithDescriptions = pageData.founders.filter(f => f.description).length;
    result.data.website = !!pageData.website;
    result.data.teamSize = !!pageData.teamSize;
    result.data.jobs = pageData.jobPostings.length;
    result.data.jobsWithLocations = pageData.jobPostings.filter(j => j.location).length;
    result.data.location = !!pageData.location;
    result.data.summary = !!pageData.oneLineSummary;

    // Print results
    console.log('\n📊 Scraping Results:');
    console.log('─'.repeat(60));
    console.log(`Founders: ${result.data.founders}`);
    if (result.data.founders > 0) {
      pageData.founders.forEach((founder, idx) => {
        console.log(`  ${idx + 1}. ${founder.firstName} ${founder.lastName}`);
        if (founder.linkedIn) {
          console.log(`     LinkedIn: ${founder.linkedIn}`);
        }
        if (founder.description) {
          console.log(`     Description: ${founder.description.substring(0, 100)}...`);
        } else {
          console.log(`     ⚠️  No description found`);
        }
      });
    } else {
      console.log('  ⚠️  No founders found');
    }

    console.log(`\nWebsite: ${pageData.website || 'Not found'}`);
    console.log(`Team Size: ${pageData.teamSize || 'Not found'}`);
    console.log(`Location: ${pageData.location || 'Not found'}`);
    console.log(`Summary: ${pageData.oneLineSummary ? pageData.oneLineSummary.substring(0, 100) + '...' : 'Not found'}`);

    console.log(`\nJobs: ${result.data.jobs}`);
    if (result.data.jobs > 0) {
      pageData.jobPostings.forEach((job, idx) => {
        console.log(`  ${idx + 1}. ${job.title}`);
        if (job.location) {
          console.log(`     Location: ${job.location}`);
        }
        if (job.description) {
          console.log(`     Description: ${job.description.substring(0, 80)}...`);
        }
      });
    } else {
      console.log('  ⚠️  No jobs found');
    }

    // Validation
    console.log('\n✅ Validation:');
    console.log('─'.repeat(60));
    const checks = [
      { name: 'Founders found', pass: result.data.founders > 0 },
      { name: 'Founder descriptions', pass: result.data.foundersWithDescriptions > 0 },
      { name: 'Website found', pass: result.data.website },
      { name: 'Team size found', pass: result.data.teamSize },
      { name: 'Jobs found', pass: result.data.jobs > 0 },
      { name: 'Job locations', pass: result.data.jobsWithLocations > 0 },
      { name: 'Location found', pass: result.data.location },
      { name: 'Summary found', pass: result.data.summary },
    ];

    checks.forEach(check => {
      const icon = check.pass ? '✅' : '❌';
      console.log(`${icon} ${check.name}`);
    });

    const passCount = checks.filter(c => c.pass).length;
    const totalChecks = checks.length;
    console.log(`\nScore: ${passCount}/${totalChecks} checks passed`);

  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
    console.error('❌ Test failed:', error);
  } finally {
    await browser.close();
  }

  return result;
}

/**
 * Main test function
 */
async function runTests() {
  console.log('🚀 YC Company Scraper Test Suite');
  console.log('='.repeat(60));

  // Get test URL from command line or use default
  const args = process.argv.slice(2);
  const urlArg = args.find(arg => arg.startsWith('--url='));
  const testUrl = urlArg ? urlArg.split('=')[1] : DEFAULT_TEST_URL;

  const results: TestResult[] = [];

  // Test single URL
  const result = await testScrapeCompany(testUrl);
  results.push(result);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Summary');
  console.log('='.repeat(60));

  results.forEach((result, idx) => {
    console.log(`\nTest ${idx + 1}: ${result.url}`);
    console.log(`Status: ${result.success ? '✅ PASSED' : '❌ FAILED'}`);
    if (result.errors.length > 0) {
      console.log(`Errors: ${result.errors.join(', ')}`);
    }
    console.log(`Founders: ${result.data.founders} (${result.data.foundersWithDescriptions} with descriptions)`);
    console.log(`Jobs: ${result.data.jobs} (${result.data.jobsWithLocations} with locations)`);
    console.log(`Website: ${result.data.website ? '✅' : '❌'}`);
    console.log(`Team Size: ${result.data.teamSize ? '✅' : '❌'}`);
    console.log(`Location: ${result.data.location ? '✅' : '❌'}`);
    console.log(`Summary: ${result.data.summary ? '✅' : '❌'}`);
  });

  const allPassed = results.every(r => r.success);
  const totalFounders = results.reduce((sum, r) => sum + r.data.founders, 0);
  const totalJobs = results.reduce((sum, r) => sum + r.data.jobs, 0);

  console.log('\n' + '='.repeat(60));
  console.log('Overall Results');
  console.log('='.repeat(60));
  console.log(`Tests: ${results.length}`);
  console.log(`Passed: ${results.filter(r => r.success).length}`);
  console.log(`Total Founders Found: ${totalFounders}`);
  console.log(`Total Jobs Found: ${totalJobs}`);
  console.log(`Overall: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  console.log('='.repeat(60));

  process.exit(allPassed ? 0 : 1);
}

// Run tests
if (require.main === module) {
  runTests()
    .catch((error) => {
      console.error('\n❌ Test suite failed:', error);
      process.exit(1);
    });
}

export { testScrapeCompany, runTests };


