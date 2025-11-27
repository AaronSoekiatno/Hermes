import { resolve } from 'path';
import { config } from 'dotenv';
// Load .env.local file FIRST before any other imports
config({ path: resolve(process.cwd(), '.env.local') });

import { parse } from 'csv-parse/sync';
import { readFileSync } from 'fs';
import { join } from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { upsertStartup } from '../lib/pinecone';
import { saveStartup } from '../lib/supabase';

// Types for CSV row data
interface CSVRow {
  YC_Link: string;
  Company_Logo: string;
  Company_Name: string;
  company_description: string;
  Batch: string;
  business_type: string;
  industry: string;
  location: string;
  founder_first_name: string;
  founder_last_name: string;
  founder_email: string;
  founder_linkedin: string;
  website: string;
  job_openings: string;
  funding_stage: string;
  amount_raised: string;
  date_raised: string;
  data_quality: string;
}

// Initialize Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

/**
 * Generates an embedding for text using Gemini
 */
async function generateEmbedding(text: string): Promise<number[]> {
  const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });

  const result = await model.embedContent({
    content: {
      role: 'user',
      parts: [{ text: text }],
    },
  });

  if (!result.embedding || !result.embedding.values || !Array.isArray(result.embedding.values)) {
    throw new Error('Failed to generate embedding: Invalid response structure');
  }

  return result.embedding.values;
}

/**
 * Parses the CSV file and returns rows as objects
 */
function parseCSV(filePath: string): CSVRow[] {
  const fileContent = readFileSync(filePath, 'utf-8');
  
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as CSVRow[];

  return records;
}

/**
 * Creates tags from business_type and industry
 */
function createTags(businessType: string, industry: string): string {
  const tags: string[] = [];
  if (businessType) tags.push(businessType);
  if (industry) {
    // Split industry by comma if it contains multiple values
    const industries = industry.split(',').map(i => i.trim()).filter(Boolean);
    tags.push(...industries);
  }
  return tags.join(', ');
}


/**
 * Main ingestion function
 */
async function ingestCSV() {
  console.log('Starting CSV ingestion...');

  // Check for embedding API key (optional - can use empty embeddings if not available)
  const useEmbeddings = !!process.env.GEMINI_API_KEY;
  
  if (!useEmbeddings) {
    console.warn('⚠️  GEMINI_API_KEY not set. Embeddings will be empty arrays.');
    console.warn('   Startup matching will be limited without embeddings.\n');
  } else {
    // Test the API key with a simple embedding request
    console.log('Validating Gemini API key...');
    try {
      await generateEmbedding('test');
      console.log('✓ API key is valid\n');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('403') || errorMessage.includes('leaked') || errorMessage.includes('Forbidden')) {
        console.warn('⚠️  Gemini API key is invalid or blocked. Continuing without embeddings.\n');
        console.warn('   To enable embeddings: Get a new key from https://aistudio.google.com/app/apikey\n');
      } else {
        throw error;
      }
    }
  }

  // Parse CSV
  const csvPath = join(process.cwd(), 'yc_companies', 'FINAL_DATASET - FINAL_DATASET.csv (1).csv');
  console.log(`Reading CSV from: ${csvPath}`);
  
  const rows = parseCSV(csvPath);
  console.log(`Found ${rows.length} rows to process`);

  // Process each row
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    
    try {
      console.log(`\n[${i + 1}/${rows.length}] Processing: ${row.Company_Name}`);

      // Skip rows with pattern data (data_quality = 🤖 PATTERN)
      if (row.data_quality?.includes('PATTERN')) {
        console.log(`  Skipping pattern-generated row`);
        continue;
      }

      // Prepare data
      const description = row.company_description || '';
      const tags = createTags(row.business_type || '', row.industry || '');
      const embeddingText = `${description}\nTags: ${tags}`;

      // Generate embedding (or use empty array if API key not available)
      let embedding: number[] = [];
      if (useEmbeddings) {
        console.log('  Generating embedding...');
        try {
          embedding = await generateEmbedding(embeddingText);
        } catch (error) {
          console.warn(`  Warning: Failed to generate embedding: ${error instanceof Error ? error.message : String(error)}`);
          console.warn('  Continuing with empty embedding...');
          embedding = []; // Use empty embedding if generation fails
        }
      } else {
        console.log('  Skipping embedding generation (no API key)...');
      }

      // Create startup ID from company name
      const startupId = row.Company_Name.toLowerCase().replace(/\s+/g, '-');

      // Save startup to Pinecone (for vector search)
      console.log('  Saving startup to Pinecone...');
      try {
        await upsertStartup(
          startupId,
          embedding,
          {
            name: row.Company_Name,
            industry: row.industry || '',
            description: description,
            funding_stage: row.funding_stage || '',
            funding_amount: row.amount_raised || '',
            location: row.location || '',
            website: row.website || '',
            tags: tags,
          }
        );
        console.log(`  ✓ Successfully saved ${row.Company_Name} to Pinecone`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to save startup to Pinecone: ${errorMessage}`);
      }

      // Save startup to Supabase (for detailed queries)
      console.log('  Saving startup to Supabase...');
      try {
        // Build startup data, only including founder fields if they have values
        const startupData: any = {
          id: startupId,
          name: row.Company_Name,
          industry: row.industry || '',
          description: description,
          funding_stage: row.funding_stage || '',
          funding_amount: row.amount_raised || '',
          location: row.location || '',
          website: row.website || '',
          tags: tags,
        };

        // Only include optional fields if they have values (skip if empty to avoid column errors)
        if (row.founder_first_name?.trim()) {
          startupData.founder_first_name = row.founder_first_name;
        }
        if (row.founder_last_name?.trim()) {
          startupData.founder_last_name = row.founder_last_name;
        }
        if (row.founder_email?.trim()) {
          startupData.founder_emails = row.founder_email;
        }
        if (row.founder_linkedin?.trim()) {
          startupData.founder_linkedin = row.founder_linkedin;
        }
        if (row.Batch?.trim()) {
          startupData.batch = row.Batch;
        }
        if (row.job_openings?.trim()) {
          startupData.job_openings = row.job_openings;
        }
        if (row.date_raised?.trim()) {
          startupData.date_raised = row.date_raised;
        }

        await saveStartup(startupData);
        console.log(`  ✓ Successfully saved ${row.Company_Name} to Supabase`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`  ⚠️  Failed to save startup to Supabase: ${errorMessage}`);
        // Continue even if Supabase save fails
      }

      successCount++;
      console.log(`  ✓ Successfully processed ${row.Company_Name}`);
      
      // Add a small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      errorCount++;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      console.error(`  ✗ Error processing ${row.Company_Name}:`);
      console.error(`    Error: ${errorMessage}`);
      if (errorStack) {
        console.error(`    Stack: ${errorStack}`);
      }
      // Continue processing other rows
    }
  }

  console.log(`\n=== Ingestion Complete ===`);
  console.log(`Success: ${successCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Total: ${rows.length}`);
}

// Run the ingestion
if (require.main === module) {
  ingestCSV()
    .then(() => {
      console.log('\nIngestion completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\nIngestion failed:', error);
      process.exit(1);
    });
}

export { ingestCSV };

