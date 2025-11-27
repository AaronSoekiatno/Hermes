# Supabase Database Schema

This document describes the expected table structure for Supabase. The application uses **Pinecone for vector search** and **Supabase for detailed relational queries** (like getting founder emails, batch info, etc.).

## Quick Setup

**Run the migration SQL file to create all tables and add missing columns:**

1. Go to your Supabase project dashboard: https://app.supabase.com
2. Navigate to **SQL Editor**
3. Open the file `supabase/migrations/001_complete_schema.sql`
4. Copy and paste the entire SQL into the editor
5. Click **Run** to execute

The migration will:
- Create `candidates`, `startups`, and `matches` tables if they don't exist
- Add any missing columns to existing tables (including founder columns)
- Create all necessary indexes and foreign key constraints
- Set up Row Level Security (RLS) policies

**This migration is idempotent** - safe to run multiple times. It will only create/add what's missing.

## Tables

### 1. `candidates`

Stores candidate information extracted from resumes.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `email` | `text` | PRIMARY KEY | Candidate's email address (unique identifier) |
| `name` | `text` | NOT NULL | Full name of the candidate |
| `summary` | `text` | | Professional summary (2-3 sentences) |
| `skills` | `text` | | Comma-separated list of skills |
| `created_at` | `timestamp` | DEFAULT now() | When the record was created |

**Example:**
```sql
CREATE TABLE candidates (
  email TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  summary TEXT,
  skills TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### 2. `startups`

Stores detailed startup information from the CSV dataset.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `text` | PRIMARY KEY | Startup ID (lowercase name with dashes, e.g., "techventures") |
| `name` | `text` | NOT NULL | Company name |
| `industry` | `text` | | Industry sector |
| `description` | `text` | | Company description |
| `funding_stage` | `text` | | Current funding stage (e.g., "Series A", "Seed") |
| `funding_amount` | `text` | | Amount raised (e.g., "$5M") |
| `location` | `text` | | Company location |
| `website` | `text` | | Company website URL |
| `tags` | `text` | | Comma-separated tags |
| `founder_first_name` | `text` | | Founder's first name |
| `founder_last_name` | `text` | | Founder's last name |
| `founder_emails` | `text` | | Founder's email address |
| `founder_linkedin` | `text` | | Founder's LinkedIn URL |
| `batch` | `text` | | YC batch (if applicable) |
| `job_openings` | `text` | | Job openings information |
| `date_raised` | `text` | | Date of funding round |
| `created_at` | `timestamp` | DEFAULT now() | When the record was created |

**Example:**
```sql
CREATE TABLE startups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  industry TEXT,
  description TEXT,
  funding_stage TEXT,
  funding_amount TEXT,
  location TEXT,
  website TEXT,
  tags TEXT,
  founder_first_name TEXT,
  founder_last_name TEXT,
  founder_emails TEXT,
  founder_linkedin TEXT,
  batch TEXT,
  job_openings TEXT,
  date_raised TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### 3. `matches`

Stores matches between candidates and startups with similarity scores.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` or `serial` | PRIMARY KEY | Auto-generated match ID |
| `candidate_email` | `text` | FOREIGN KEY → `candidates.email` | Candidate's email |
| `startup_id` | `text` | FOREIGN KEY → `startups.id` | Startup ID |
| `score` | `float` | NOT NULL | Similarity score (0-1) from vector search |
| `matched_at` | `timestamp` | DEFAULT now() | When the match was created |

**Example:**
```sql
CREATE TABLE matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_email TEXT NOT NULL REFERENCES candidates(email) ON DELETE CASCADE,
  startup_id TEXT NOT NULL REFERENCES startups(id) ON DELETE CASCADE,
  score FLOAT NOT NULL,
  matched_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(candidate_email, startup_id) -- Prevent duplicate matches
);
```

## Data Flow

1. **Resume Upload** (`/api/upload-resume`):
   - Extracts candidate data (name, email, skills, summary)
   - Saves to **Pinecone** (for vector search)
   - Saves to **Supabase** `candidates` table (for detailed queries)
   - Finds matching startups via Pinecone vector search
   - Saves matches to **Supabase** `matches` table

2. **CSV Ingestion** (`scripts/ingest-csv.ts`):
   - Reads startup data from CSV
   - Generates embeddings
   - Saves to **Pinecone** (for vector search)
   - Saves to **Supabase** `startups` table (for detailed queries including founder info)

## Usage Examples

### Get candidate with all their matches:
```typescript
import { getCandidateMatches } from '@/lib/supabase';

const matches = await getCandidateMatches('john@example.com');
// Returns matches with full startup details including founder_emails
```

### Get startup details including founder email:
```typescript
import { getStartup } from '@/lib/supabase';

const startup = await getStartup('techventures');
console.log(startup.founder_emails); // Founder's email
```

### Query matches with startup details:
```sql
SELECT 
  m.score,
  m.matched_at,
  s.name,
  s.founder_emails,
  s.founder_linkedin,
  s.website
FROM matches m
JOIN startups s ON m.startup_id = s.id
WHERE m.candidate_email = 'john@example.com'
ORDER BY m.score DESC;
```

## Notes

- **Pinecone** is used for fast vector similarity search (matching candidates to startups)
- **Supabase** is used for detailed relational queries (getting founder emails, batch info, etc.)
- Both systems are updated in parallel to ensure data consistency
- The `id` field in `startups` is generated from the company name: `name.toLowerCase().replace(/\s+/g, '-')`

