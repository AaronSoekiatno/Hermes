/**
 * Agentic Enrichment Orchestrator
 * 
 * This is the full agentic workflow that:
 * 1. REASONS about what data is missing
 * 2. KNOWS WHERE to find it (which sources)
 * 3. KNOWS HOW to search for it (adaptive queries)
 * 4. UNDERSTANDS if data matches and is relevant
 * 5. VALIDATES extracted data
 * 6. DECIDES if more searches are needed
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { searchWeb, extractFounderInfo, extractAllEnrichmentData } from './web_search_agent';
import {
  analyzeMissingData,
  generateSearchPlan,
  checkRelevance,
  validateExtractedData,
  shouldContinueSearching,
  type SearchQuery,
} from './reasoning_agent';

// Initialize Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase credentials');
}

const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey);

interface StartupRecord {
  id: string;
  name: string;
  description?: string;
  website?: string;
  founder_names?: string;
  founder_linkedin?: string;
  founder_emails?: string;
  job_openings?: string;
  funding_amount?: string;
  [key: string]: any;
}

interface AgentState {
  startup: StartupRecord;
  missingData: any;
  searchHistory: SearchQuery[];
  extractedData: Partial<StartupRecord>;
  confidence: Record<string, number>;
  attempts: number;
  maxAttempts: number;
}

/**
 * Main Agentic Enrichment Function
 * This is where the full reasoning loop happens
 */
export async function agenticEnrichStartup(startup: StartupRecord): Promise<boolean> {
  console.log(`\n🤖 Starting AGENTIC enrichment for: ${startup.name}`);
  console.log(`   This agent will REASON about what's missing and WHERE to find it\n`);

  let state: AgentState = {
    startup,
    missingData: null,
    searchHistory: [],
    extractedData: {},
    confidence: {},
    attempts: 0,
    maxAttempts: 5, // Maximum search attempts
  };

  try {
    // Update status to in_progress
    await supabase
      .from('startups')
      .update({ enrichment_status: 'in_progress' })
      .eq('id', startup.id);

    // ============================================================
    // STEP 1: REASON about what data is missing
    // ============================================================
    console.log('📊 Step 1: Analyzing missing data...');
    state.missingData = await analyzeMissingData(startup);
    console.log(`   Missing: ${state.missingData.missingFields.join(', ')}`);
    console.log(`   Priority: ${state.missingData.priority}`);
    console.log(`   Reasoning: ${state.missingData.reasoning}\n`);

    if (state.missingData.missingFields.length === 0) {
      console.log('   ✅ No data missing, enrichment complete!');
      await supabase
        .from('startups')
        .update({
          needs_enrichment: false,
          enrichment_status: 'completed',
        })
        .eq('id', startup.id);
      return true;
    }

    // ============================================================
    // AGENTIC LOOP: Continue until complete or max attempts
    // ============================================================
    while (state.attempts < state.maxAttempts) {
      state.attempts++;
      console.log(`\n🔄 Attempt ${state.attempts}/${state.maxAttempts}`);

      // ============================================================
      // STEP 2: REASON about WHERE and HOW to find data
      // ============================================================
      console.log('🧠 Step 2: Generating search plan...');
      const searchPlan = await generateSearchPlan(startup, state.missingData);
      console.log(`   Reasoning: ${searchPlan.reasoning}`);
      console.log(`   Expected sources: ${searchPlan.expectedSources.join(', ')}`);
      console.log(`   Generated ${searchPlan.queries.length} queries:\n`);

      // Sort queries by priority
      const sortedQueries = searchPlan.queries.sort((a, b) => a.priority - b.priority);

      // ============================================================
      // STEP 3: Execute searches and evaluate relevance
      // ============================================================
      for (const searchQuery of sortedQueries) {
        console.log(`   🔍 Query: "${searchQuery.query}"`);
        console.log(`      Purpose: ${searchQuery.purpose}`);
        console.log(`      Source: ${searchQuery.source}`);

        try {
          // Execute search
          const results = await searchWeb(searchQuery.query);
          console.log(`      Found ${results.length} results`);

          if (results.length === 0) {
            console.log(`      ⚠️  No results found, skipping...`);
            continue;
          }

          // ============================================================
          // STEP 4: UNDERSTAND if results are relevant
          // ============================================================
          console.log(`      🎯 Checking relevance...`);
          const relevance = await checkRelevance(results, searchQuery, startup);
          console.log(`      Relevance: ${relevance.isRelevant ? '✅ YES' : '❌ NO'} (confidence: ${relevance.confidence.toFixed(2)})`);
          console.log(`      Reasoning: ${relevance.reasoning}`);

          if (!relevance.isRelevant || relevance.confidence < 0.5) {
            console.log(`      ⚠️  Results not relevant, trying next query...`);
            continue;
          }

          // ============================================================
          // STEP 5: Extract data (using LLM)
          // ============================================================
          console.log(`      📥 Extracting data...`);
          let extracted: any = {};

          // Use extracted data from relevance check if available
          if (relevance.extractedData) {
            extracted = relevance.extractedData;
          } else {
            // Fallback to extraction functions
            if (searchQuery.purpose.includes('founder')) {
              const founderInfo = await extractFounderInfo(results, startup.name);
              extracted = {
                founder_names: founderInfo.founder_names,
                founder_linkedin: founderInfo.founder_linkedin,
                founder_emails: founderInfo.founder_emails,
              };
            } else {
              // Use comprehensive extraction
              const comprehensive = await extractAllEnrichmentData(results, startup.name);
              extracted = comprehensive;
            }
          }

          // ============================================================
          // STEP 6: VALIDATE extracted data
          // ============================================================
          console.log(`      ✔️  Validating extracted data...`);
          for (const [field, value] of Object.entries(extracted)) {
            if (value && typeof value === 'string' && value.trim()) {
              const validation = await validateExtractedData(value, field, startup);
              console.log(`         ${field}: ${validation.isValid ? '✅ Valid' : '❌ Invalid'} (confidence: ${validation.confidence.toFixed(2)})`);

              if (validation.isValid && validation.confidence >= 0.7) {
                // Use validated/corrected data
                state.extractedData[field] = validation.correctedData || value;
                state.confidence[field] = validation.confidence;

                if (validation.issues.length > 0) {
                  console.log(`         Issues: ${validation.issues.join(', ')}`);
                }
              } else if (validation.issues.length > 0) {
                console.log(`         ⚠️  Skipping due to: ${validation.issues.join(', ')}`);
              }
            }
          }

          // Add to search history
          state.searchHistory.push(searchQuery);

          // Small delay to avoid rate limiting (increased for free tier)
          await new Promise(resolve => setTimeout(resolve, 3000));

        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          // Only log if it's a real error, not just empty results
          if (!errorMsg.includes('returned no results')) {
            console.warn(`      ⚠️  Search error: ${errorMsg}`);
          }
          continue;
        }
      }

      // ============================================================
      // STEP 7: DECIDE if more searches are needed
      // ============================================================
      console.log(`\n🤔 Step 7: Deciding if more searches needed...`);
      const decision = await shouldContinueSearching(
        state.extractedData,
        state.missingData,
        state.attempts
      );
      console.log(`   Decision: ${decision.continue ? '🔄 Continue' : '✅ Stop'}`);
      console.log(`   Reasoning: ${decision.reasoning}`);

      if (!decision.continue) {
        break;
      }

      // Update missing data analysis for next iteration
      const stillMissing = state.missingData.missingFields.filter(
        (field: string) => !state.extractedData[field]
      );
      if (stillMissing.length === 0) {
        console.log(`   ✅ All missing data found!`);
        break;
      }

      state.missingData.missingFields = stillMissing;
      console.log(`   Still missing: ${stillMissing.join(', ')}`);
    }

    // ============================================================
    // STEP 8: Update database with enriched data
    // ============================================================
    console.log(`\n💾 Step 8: Updating database...`);
    const updates: any = {};

    // Only update fields that are missing or can be improved
    for (const [field, value] of Object.entries(state.extractedData)) {
      const conf = state.confidence[field] || 0;
      if (value && conf >= 0.7 && !startup[field]) {
        updates[field] = value;
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.needs_enrichment = false;
      updates.enrichment_status = 'completed';
      updates.updated_at = new Date().toISOString();

      const { error } = await supabase
        .from('startups')
        .update(updates)
        .eq('id', startup.id);

      if (error) {
        throw error;
      }

      console.log(`   ✅ Updated fields: ${Object.keys(updates).filter(k => k !== 'needs_enrichment' && k !== 'enrichment_status' && k !== 'updated_at').join(', ')}`);
      console.log(`   📊 Confidence scores: ${Object.entries(state.confidence).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(', ')}`);
      return true;
    } else {
      console.log(`   ℹ️  No new data found or confidence too low`);
      await supabase
        .from('startups')
        .update({
          needs_enrichment: false,
          enrichment_status: 'completed',
        })
        .eq('id', startup.id);
      return true;
    }

  } catch (error) {
    console.error(`  ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    await supabase
      .from('startups')
      .update({ enrichment_status: 'failed' })
      .eq('id', startup.id);
    return false;
  }
}

/**
 * Get startup by ID and enrich it
 */
export async function agenticEnrichStartupById(startupId: string) {
  const { data, error } = await supabase
    .from('startups')
    .select('*')
    .eq('id', startupId)
    .single();

  if (error || !data) {
    throw new Error(`Startup not found: ${startupId}`);
  }

  return await agenticEnrichStartup(data);
}

// Run if called directly
if (require.main === module) {
  const args = process.argv.slice(2);
  let startupId: string | null = null;

  for (const arg of args) {
    if (arg.startsWith('--id=')) {
      startupId = arg.replace('--id=', '').trim();
      break;
    }
  }

  if (startupId) {
    console.log(`🎯 Agentic enrichment for startup ID: ${startupId}\n`);
    agenticEnrichStartupById(startupId)
      .then((success) => {
        if (success) {
          console.log('\n✅ Agentic enrichment completed!');
        } else {
          console.log('\n⚠️  Enrichment completed with warnings');
        }
        process.exit(0);
      })
      .catch((error) => {
        console.error('\n❌ Agentic enrichment failed:', error);
        process.exit(1);
      });
  } else {
    console.error('Usage: tsx agentic_enrichment.ts --id=<startup_id>');
    process.exit(1);
  }
}

