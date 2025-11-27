# Pinecone Setup Guide

This guide explains how to set up and use Pinecone for candidate-startup matching in ColdStart.

## Architecture Overview

```
Resume Upload → Gemini Extraction → Gemini Embedding → Pinecone Storage → Vector Similarity Search
```

### Data Flow

1. **Resume Upload** (PDF/DOCX)
2. **Gemini Text Extraction** - Extracts name, email, skills (6-12), summary (2-3 sentences)
3. **Gemini Embedding** - Generates 768-dimensional vector using `text-embedding-004`
4. **Pinecone Storage** - Stores vector + metadata in `candidates` namespace
5. **Vector Search** - Queries `startups` namespace for top 10 matches
6. **Return Results** - Candidate data + matched startups with similarity scores

---

## Prerequisites

### 1. Pinecone Account Setup

1. Sign up at [pinecone.io](https://www.pinecone.io/)
2. Create a new project
3. Get your API key from the dashboard

### 2. Create Pinecone Index

You need to create an index with these specifications:

**Via Pinecone Dashboard:**
- **Name**: `startups` (or update `PINECONE_INDEX_NAME` in `.env.local`)
- **Dimensions**: `768` (Gemini text-embedding-004 output size)
- **Metric**: `cosine` (standard for semantic similarity)
- **Cloud**: AWS, GCP, or Azure (choose closest to your region)
- **Region**: Choose based on your location

**Via Code (one-time setup):**

```typescript
import { Pinecone } from '@pinecone-database/pinecone';

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });

await pc.createIndex({
  name: 'startups',
  dimension: 768,
  metric: 'cosine',
  spec: {
    serverless: {
      cloud: 'aws',
      region: 'us-east-1'
    }
  }
});
```

### 3. Environment Variables

Update your `.env.local` file:

```bash
# Gemini API (for extraction and embeddings)
GEMINI_API_KEY=your_gemini_api_key_here

# Pinecone (for vector storage and search)
PINECONE_API_KEY=your_pinecone_api_key_here
PINECONE_INDEX_NAME=startups

# Supabase (optional - for additional data storage)
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_SUPBASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

---

## File Structure

### New Files Created

```
lib/
  pinecone.ts                    # Pinecone client and utilities

scripts/
  test-resume-parsing.ts         # Test script for resume upload flow

app/api/upload-resume/
  route.ts                       # Updated to use Pinecone (removed Helix)
  utils.ts                       # Updated response type with matches
```

### Removed Files

```
lib/
  helix.ts                       # ❌ REMOVED - No longer needed

db/
  schema.hx                      # ⚠️  Can be removed (Helix schema)
  queries.hx                     # ⚠️  Can be removed (Helix queries)
```

---

## API Reference

### Pinecone Utilities ([lib/pinecone.ts](lib/pinecone.ts))

#### `upsertCandidate(id, embedding, metadata)`

Stores a candidate in Pinecone.

```typescript
await upsertCandidate(
  'john@example.com',
  [0.123, 0.456, ...], // 768-dim vector
  {
    name: 'John Doe',
    email: 'john@example.com',
    summary: 'Experienced software engineer...',
    skills: 'JavaScript, React, Node.js, Python',
  }
);
```

**Namespace:** `candidates`

#### `upsertStartup(id, embedding, metadata)`

Stores a startup in Pinecone.

```typescript
await upsertStartup(
  'acme-corp',
  [0.789, 0.012, ...], // 768-dim vector
  {
    name: 'Acme Corp',
    industry: 'Technology',
    description: 'We build amazing products...',
    funding_stage: 'Series A',
    funding_amount: '$5M',
    location: 'San Francisco',
    website: 'https://acme.com',
    tags: 'SaaS, B2B, AI',
  }
);
```

**Namespace:** `startups`

#### `findMatchingStartups(embedding, topK)`

Finds top K matching startups for a candidate's embedding.

```typescript
const matches = await findMatchingStartups(candidateEmbedding, 10);

// Returns:
[
  {
    id: 'acme-corp',
    score: 0.87,  // Similarity score (0-1)
    metadata: {
      name: 'Acme Corp',
      industry: 'Technology',
      // ... other fields
    }
  },
  // ... 9 more matches
]
```

#### Helper Functions

```typescript
// Get candidate by ID (email)
const candidate = await getCandidateById('john@example.com');

// Get startup by ID
const startup = await getStartupById('acme-corp');

// Delete candidate
await deleteCandidate('john@example.com');

// Delete startup
await deleteStartup('acme-corp');
```

---

## Testing

### Step 1: Start the Development Server

```bash
npm run dev
```

The server will start at `http://localhost:3000`.

### Step 2: Test Resume Parsing

Use the test script to upload a resume and see the results:

```bash
# Test with a PDF
npm run test-resume -- path/to/resume.pdf

# Test with a DOCX
npm run test-resume -- path/to/resume.docx
```

**Example Output:**

```
🧪 Testing Resume Upload Flow

============================================================

📄 File: john_doe_resume.pdf
📦 Size: 127.45 KB
📋 Type: PDF

⏳ Uploading to API...

============================================================

✅ Resume Processing Successful!

📝 Extracted Information:
────────────────────────────────────────────────────────────
Name:    John Doe
Email:   john.doe@example.com
Summary: Experienced software engineer with 5+ years in full-stack development.

🔧 Skills Extracted:
  1. JavaScript
  2. React
  3. Node.js
  4. Python
  5. PostgreSQL
  6. AWS

🧬 Embedding:
  Dimensions: 768
  First 5 values: [0.0234, -0.0156, 0.0789, -0.0023, 0.0445...]

💾 Database:
  Saved to Pinecone: ✅ Yes

🎯 Matching Startups:
────────────────────────────────────────────────────────────

1. Acme Corp (Score: 87.23%)
   Industry: Technology
   Location: San Francisco
   Funding: Series A - $5M
   Tags: SaaS, B2B, AI
   Website: https://acme.com

2. TechStart Inc (Score: 82.14%)
   Industry: Software
   Location: New York
   Funding: Seed - $1M
   Tags: B2C, Mobile, Cloud

...

============================================================

✨ Test completed successfully!
```

### Step 3: Test via API Directly

You can also test using `curl` or Postman:

```bash
curl -X POST http://localhost:3000/api/upload-resume \
  -F "resume=@path/to/resume.pdf"
```

---

## Understanding the Response

### Success Response

```json
{
  "success": true,
  "rawText": "PDF processed directly by Gemini (no text extraction required)",
  "name": "John Doe",
  "email": "john.doe@example.com",
  "skills": ["JavaScript", "React", "Node.js", "Python", "PostgreSQL", "AWS"],
  "summary": "Experienced software engineer with 5+ years in full-stack development.",
  "embedding": [0.0234, -0.0156, ...], // 768 values
  "savedToDatabase": true,
  "matches": [
    {
      "id": "acme-corp",
      "score": 0.8723,
      "startup": {
        "name": "Acme Corp",
        "industry": "Technology",
        "description": "We build amazing products...",
        "funding_stage": "Series A",
        "funding_amount": "$5M",
        "location": "San Francisco",
        "website": "https://acme.com",
        "tags": "SaaS, B2B, AI",
        "createdAt": "2025-01-26T10:30:00.000Z"
      }
    }
    // ... more matches
  ]
}
```

### Error Response

```json
{
  "success": false,
  "error": "Failed to analyze resume content.",
  "details": "Invalid API key"
}
```

---

## Populating Startup Data

### Option 1: CSV Ingestion (Update Required)

The existing CSV ingestion script ([scripts/ingest-csv.ts](scripts/ingest-csv.ts)) needs to be updated to use Pinecone instead of Helix.

**TODO:** Update the script to:
1. Import `upsertStartup` from `@/lib/pinecone`
2. Replace Helix queries with Pinecone upserts
3. Remove Helix-specific code

### Option 2: Manual API

Create a separate API endpoint to add startups:

```typescript
// app/api/add-startup/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { upsertStartup } from '@/lib/pinecone';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function POST(request: NextRequest) {
  const data = await request.json();

  // Generate embedding
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });

  const embeddingText = `${data.description}\nTags: ${data.tags}`;
  const result = await model.embedContent({
    content: { role: 'user', parts: [{ text: embeddingText }] }
  });

  // Save to Pinecone
  await upsertStartup(
    data.name.toLowerCase().replace(/\s+/g, '-'), // ID
    result.embedding.values,
    data
  );

  return NextResponse.json({ success: true });
}
```

### Option 3: Direct Script

```typescript
import { upsertStartup } from './lib/pinecone';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });

const startups = [
  {
    name: 'Acme Corp',
    industry: 'Technology',
    description: 'We build amazing products that help developers...',
    funding_stage: 'Series A',
    funding_amount: '$5M',
    location: 'San Francisco',
    website: 'https://acme.com',
    tags: 'SaaS, B2B, AI',
  },
  // ... more startups
];

for (const startup of startups) {
  const embeddingText = `${startup.description}\nTags: ${startup.tags}`;
  const result = await model.embedContent({
    content: { role: 'user', parts: [{ text: embeddingText }] }
  });

  await upsertStartup(
    startup.name.toLowerCase().replace(/\s+/g, '-'),
    result.embedding.values,
    startup
  );

  console.log(`✅ Added ${startup.name}`);
}
```

---

## Namespaces Explained

Pinecone uses **namespaces** to logically separate data within a single index:

- **`candidates`** - All candidate resumes and embeddings
- **`startups`** - All startup descriptions and embeddings

**Benefits:**
- Single index = lower cost
- Logical separation of data types
- Easy to query each namespace independently

---

## Key Differences from Helix DB

| Feature | Helix DB | Pinecone |
|---------|----------|----------|
| **Type** | Graph database | Vector database |
| **Storage** | Nodes with properties | Vectors with metadata |
| **Relationships** | Native graph edges | N/A (metadata only) |
| **Vector Search** | ❌ Not implemented | ✅ Native, optimized |
| **Query Language** | Custom HQL | SDK methods |
| **Hosting** | Self-hosted (Docker) | Managed cloud service |
| **Scaling** | Manual | Automatic (serverless) |

---

## Troubleshooting

### Issue: "Index not found"

**Solution:** Create the Pinecone index first (see Prerequisites section)

### Issue: "Dimension mismatch"

**Solution:** Ensure your index has dimension=768 (Gemini embedding size)

### Issue: "No matches found"

**Solution:** The startups namespace is empty. Populate it first using CSV ingestion or manual scripts.

### Issue: "API key invalid"

**Solution:** Check that `PINECONE_API_KEY` is set correctly in `.env.local`

### Issue: Test script fails with "form-data not found"

**Solution:** Run `npm install --save-dev form-data`

---

## Next Steps

1. ✅ Pinecone setup complete
2. ⬜ Test resume parsing with your own resume
3. ⬜ Populate startup data in Pinecone
4. ⬜ Update CSV ingestion script to use Pinecone
5. ⬜ Build frontend to display matching results
6. ⬜ Add filtering by location, industry, funding stage, etc.
7. ⬜ Implement candidate dashboard to view saved matches

---

## Additional Resources

- [Pinecone Documentation](https://docs.pinecone.io/)
- [Gemini API Documentation](https://ai.google.dev/docs)
- [Next.js API Routes](https://nextjs.org/docs/api-routes/introduction)

---

## Support

For issues or questions:
1. Check [PINECONE_SETUP.md](PINECONE_SETUP.md) (this file)
2. Review [scripts/test-resume-parsing.ts](scripts/test-resume-parsing.ts) for examples
3. Check the API response for detailed error messages
