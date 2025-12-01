import { resolve } from 'path';
import { config } from 'dotenv';
// Load .env.local file
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { searchWebForStartup, EnrichedData } from './web_search_agent';

// Types
interface FundingData {
  funding_amount: string | null;
  funding_stage: string | null;
  funding_date: string | null;
  confidence: number;
  source: 'web_search' | 'techcrunch' | 'crunchbase';
}

interface HotnessScore {
  score: number; // 0-100
  factors: {
    fundingAmount: number; // 0-30 points
    fundingRecency: number; // 0-30 points
    fundingStage: number; // 0-30 points
    teamGrowth: number; // 0-5 points
    jobPostings: number; // 0-5 points
  };
}

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase credentials');
}

const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey);

/**
 * Calculate funding amount score (0-30 points)
 */
function calculateFundingAmountScore(fundingAmount: string | null): number {
  if (!fundingAmount) return 0;

  // Extract number and unit
  const match = fundingAmount.match(/\$?([\d.]+)\s*([MBK])?/i);
  if (!match) return 0;

  const amount = parseFloat(match[1]);
  const unit = match[2]?.toUpperCase() || 'M';

  // Normalize to millions
  let amountInMillions = amount;
  if (unit === 'B') {
    amountInMillions = amount * 1000;
  } else if (unit === 'K') {
    amountInMillions = amount / 1000;
  }

  // Score based on amount
  // 0-5M: 5-15 points
  // 5-20M: 15-25 points
  // 20M+: 25-30 points
  if (amountInMillions >= 50) return 30;
  if (amountInMillions >= 20) return 25;
  if (amountInMillions >= 10) return 20;
  if (amountInMillions >= 5) return 15;
  if (amountInMillions >= 1) return 10;
  return 5;
}

/**
 * Calculate funding recency score (0-30 points)
 */
function calculateFundingRecencyScore(fundingDate: string | null): number {
  if (!fundingDate) return 0;

  try {
    // Parse various date formats
    let date: Date | null = null;

    // Try YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(fundingDate)) {
      date = new Date(fundingDate);
    }
    // Try YYYY-MM format
    else if (/^\d{4}-\d{2}$/.test(fundingDate)) {
      date = new Date(fundingDate + '-01');
    }
    // Try YYYY format
    else if (/^\d{4}$/.test(fundingDate)) {
      date = new Date(fundingDate + '-01-01');
    }
    // Try Month Year format
    else {
      date = new Date(fundingDate);
    }

    if (!date || isNaN(date.getTime())) return 0;

    const now = new Date();
    const monthsAgo = (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24 * 30);

    // Score based on recency
    // <3 months: 30 points
    // 3-6 months: 25 points
    // 6-12 months: 20 points
    // 12-24 months: 10 points
    // 24+ months: 0-5 points
    if (monthsAgo <= 3) return 30;
    if (monthsAgo <= 6) return 25;
    if (monthsAgo <= 12) return 20;
    if (monthsAgo <= 24) return 10;
    if (monthsAgo <= 36) return 5;
    return 0;
  } catch (error) {
    return 0;
  }
}

/**
 * Calculate funding stage score (0-30 points)
 */
function calculateFundingStageScore(fundingStage: string | null): number {
  if (!fundingStage) return 0;

  const stageLower = fundingStage.toLowerCase();

  if (stageLower.includes('seed') || stageLower.includes('pre-seed')) {
    return 10;
  } else if (stageLower.includes('series a')) {
    return 15;
  } else if (stageLower.includes('series b')) {
    return 20;
  } else if (stageLower.includes('series c')) {
    return 25;
  } else if (stageLower.includes('series d') || stageLower.includes('series e')) {
    return 30;
  } else if (stageLower.includes('ipo')) {
    return 30;
  }

  return 5; // Unknown stage
}

/**
 * Calculate team growth score (0-5 points)
 */
function calculateTeamGrowthScore(teamSize: string | null): number {
  if (!teamSize) return 0;

  const size = parseInt(teamSize);
  if (isNaN(size)) return 0;

  // Larger teams indicate growth/scaling
  // 1-5: 1 point
  // 6-20: 2 points
  // 21-50: 3 points
  // 51-100: 4 points
  // 100+: 5 points
  if (size >= 100) return 5;
  if (size >= 51) return 4;
  if (size >= 21) return 3;
  if (size >= 6) return 2;
  if (size >= 1) return 1;
  return 0;
}

/**
 * Calculate job postings score (0-5 points)
 */
function calculateJobPostingsScore(jobOpenings: string | null, hiringRoles: string | null): number {
  if (!jobOpenings && !hiringRoles) return 0;

  // Count number of jobs
  let jobCount = 0;
  if (jobOpenings) {
    jobCount = jobOpenings.split(',').filter(j => j.trim().length > 0).length;
  }

  // Active hiring indicates growth
  // 0 jobs: 0 points
  // 1-2 jobs: 2 points
  // 3-5 jobs: 3 points
  // 6-10 jobs: 4 points
  // 10+ jobs: 5 points
  if (jobCount >= 10) return 5;
  if (jobCount >= 6) return 4;
  if (jobCount >= 3) return 3;
  if (jobCount >= 1) return 2;
  return 0;
}

/**
 * Calculate hotness score for a startup
 */
export function calculateHotnessScore(
  fundingAmount: string | null,
  fundingDate: string | null,
  fundingStage: string | null,
  teamSize: string | null,
  jobOpenings: string | null,
  hiringRoles: string | null
): HotnessScore {
  const factors = {
    fundingAmount: calculateFundingAmountScore(fundingAmount),
    fundingRecency: calculateFundingRecencyScore(fundingDate),
    fundingStage: calculateFundingStageScore(fundingStage),
    teamGrowth: calculateTeamGrowthScore(teamSize),
    jobPostings: calculateJobPostingsScore(jobOpenings, hiringRoles),
  };

  const score = Object.values(factors).reduce((sum, val) => sum + val, 0);

  return {
    score: Math.min(100, Math.round(score)),
    factors,
  };
}

/**
 * Fetch funding data for a startup using web search
 */
async function fetchFundingDataWebSearch(companyName: string): Promise<FundingData> {
  try {
    console.log(`   🔍 Searching web for funding data...`);

    // Use existing web search agent
    const enrichedData = await searchWebForStartup({
      Company_Name: companyName,
      YC_Link: '',
      company_description: '',
      Batch: '',
      business_type: '',
      industry: '',
      location: '',
    });

    // Extract funding data from enrichment
    return {
      funding_amount: enrichedData.funding_amount || null,
      funding_stage: enrichedData.funding_stage || null,
      funding_date: enrichedData.funding_date || null,
      confidence: 0.7, // Web search has moderate confidence
      source: 'web_search',
    };
  } catch (error) {
    console.error(`   ❌ Web search failed: ${error instanceof Error ? error.message : String(error)}`);
    return {
      funding_amount: null,
      funding_stage: null,
      funding_date: null,
      confidence: 0,
      source: 'web_search',
    };
  }
}

/**
 * Get startups needing funding enrichment
 */
async function getStartupsNeedingFundingData(): Promise<any[]> {
  try {
    const { data, error } = await supabase
      .from('startups')
      .select('*')
      .eq('data_source', 'yc')
      .is('funding_amount', null)
      .eq('enrichment_status', 'pending')
      .limit(100); // Process in batches of 100

    if (error) {
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching startups:', error);
    return [];
  }
}

/**
 * Update startup with funding data and hotness score
 */
async function updateStartupFundingData(
  startupId: string,
  fundingData: FundingData,
  hotnessScore: HotnessScore
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('startups')
      .update({
        funding_amount: fundingData.funding_amount,
        round_type: fundingData.funding_stage,
        date: fundingData.funding_date,
        hotness_score: hotnessScore.score,
        hotness_factors: hotnessScore.factors,
        enrichment_status: 'completed',
      })
      .eq('id', startupId);

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    console.error(`Error updating startup: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Main function to fetch funding data for all YC startups
 */
async function fetchAllFundingData() {
  console.log('🚀 Starting Funding Data Enrichment...\n');

  // Test Supabase connection
  try {
    const { data, error } = await supabase.from('startups').select('id').limit(1);
    if (error && error.code !== 'PGRST116') {
      throw error;
    }
    console.log('✓ Connected to Supabase\n');
  } catch (error) {
    throw new Error(
      `Cannot connect to Supabase: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Get startups needing funding data
  console.log('🔍 Fetching startups needing funding data...');
  const startups = await getStartupsNeedingFundingData();
  console.log(`   Found ${startups.length} startups needing funding data\n`);

  if (startups.length === 0) {
    console.log('✅ All startups already have funding data!');
    return;
  }

  let successCount = 0;
  let errorCount = 0;
  let noDataCount = 0;

  for (let i = 0; i < startups.length; i++) {
    const startup = startups[i];

    try {
      console.log(`\n[${i + 1}/${startups.length}] 💰 Processing: ${startup.name}`);

      // Fetch funding data using web search
      const fundingData = await fetchFundingDataWebSearch(startup.name);

      if (!fundingData.funding_amount && !fundingData.funding_stage) {
        console.log('   ℹ️  No funding data found');
        noDataCount++;
        continue;
      }

      console.log(`   Found funding data:`);
      console.log(`     Amount: ${fundingData.funding_amount || 'N/A'}`);
      console.log(`     Stage: ${fundingData.funding_stage || 'N/A'}`);
      console.log(`     Date: ${fundingData.funding_date || 'N/A'}`);

      // Calculate hotness score
      const hotnessScore = calculateHotnessScore(
        fundingData.funding_amount,
        fundingData.funding_date,
        fundingData.funding_stage,
        startup.team_size,
        startup.job_openings,
        startup.hiring_roles
      );

      console.log(`   🔥 Hotness Score: ${hotnessScore.score}/100`);
      console.log(`     Funding Amount: ${hotnessScore.factors.fundingAmount}`);
      console.log(`     Recency: ${hotnessScore.factors.fundingRecency}`);
      console.log(`     Stage: ${hotnessScore.factors.fundingStage}`);
      console.log(`     Team Growth: ${hotnessScore.factors.teamGrowth}`);
      console.log(`     Job Postings: ${hotnessScore.factors.jobPostings}`);

      // Update startup in database
      const success = await updateStartupFundingData(startup.id, fundingData, hotnessScore);

      if (success) {
        successCount++;
        console.log('   ✅ Successfully updated funding data');
      } else {
        errorCount++;
      }

      // Rate limiting - wait between requests
      await new Promise(resolve => setTimeout(resolve, 3000));

    } catch (error) {
      errorCount++;
      console.error(`   ❌ Error processing ${startup.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 Funding Data Enrichment Complete');
  console.log('='.repeat(60));
  console.log(`Total processed: ${startups.length}`);
  console.log(`Successfully enriched: ${successCount}`);
  console.log(`No data found: ${noDataCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log('='.repeat(60));
}

// Run the fetcher
if (require.main === module) {
  fetchAllFundingData()
    .then(() => {
      console.log('\n✅ Process completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Process failed:', error);
      process.exit(1);
    });
}

export { fetchAllFundingData, calculateHotnessScore };
