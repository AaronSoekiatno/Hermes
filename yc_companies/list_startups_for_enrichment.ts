/**
 * Helper script to list startups that need enrichment
 * Useful for finding a startup ID to test enrichment
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function listStartupsNeedingEnrichment(limit: number = 10) {
  const { data, error } = await supabase
    .from('startups')
    .select('id, name, description, needs_enrichment, enrichment_status, data_source')
    .eq('needs_enrichment', true)
    .in('enrichment_status', ['pending', 'failed'])
    .limit(limit);

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) {
    console.log('✅ No startups need enrichment!');
    return;
  }

  console.log(`\n📋 Found ${data.length} startups needing enrichment:\n`);
  
  data.forEach((startup, index) => {
    console.log(`${index + 1}. ${startup.name}`);
    console.log(`   ID: ${startup.id}`);
    console.log(`   Status: ${startup.enrichment_status}`);
    console.log(`   Source: ${startup.data_source || 'unknown'}`);
    console.log(`   Description: ${startup.description?.substring(0, 80) || 'N/A'}...`);
    console.log(`   Command: npm run enrich-agentic -- --id=${startup.id}`);
    console.log('');
  });

  if (data.length > 0) {
    console.log(`\n💡 To test agentic enrichment on the first startup, run:`);
    console.log(`   npm run enrich-agentic -- --id=${data[0].id}`);
    console.log(`\n📝 Or use the regular enrichment (non-agentic):`);
    console.log(`   npm run enrich-startup -- --id=${data[0].id}`);
  }
}

// Run if called directly
if (require.main === module) {
  const limit = process.argv[2] ? parseInt(process.argv[2]) : 10;
  listStartupsNeedingEnrichment(limit)
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('❌ Error:', error);
      process.exit(1);
    });
}

export { listStartupsNeedingEnrichment };

