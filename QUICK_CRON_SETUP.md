# Quick Cron Setup Guide

## Fastest Setup (5 minutes)

### Option 1: Supabase pg_cron (Recommended - No External Services!)

**Why Supabase?** It's built-in, free, and everything runs in your database!

1. **Enable extensions** in Supabase Dashboard:
   - Database → Extensions → Enable "pg_cron"
   - Database → Extensions → Enable "pg_net"

2. **Set your API URL** (run in SQL Editor):
   ```sql
   -- Using Vault (recommended)
   SELECT vault.create_secret('https://your-app.vercel.app/api/scrape-techcrunch', 'techcrunch_api_url');
   SELECT vault.create_secret('your-secret-key', 'techcrunch_cron_secret');
   
   -- OR using database settings
   ALTER DATABASE postgres SET app.techcrunch_api_url = 'https://your-app.vercel.app/api/scrape-techcrunch';
   ALTER DATABASE postgres SET app.cron_secret = 'your-secret-key';
   ```

3. **Run the migration**:
   ```bash
   supabase migration up
   ```
   Or manually run `supabase/migrations/006_setup_techcrunch_cron.sql`

4. **Done!** The cron job is now scheduled. Check it:
   ```sql
   SELECT * FROM cron.job WHERE jobname = 'techcrunch-scraper-hourly';
   ```

See `SUPABASE_CRON_SETUP.md` for detailed instructions.

### Option 2: Vercel Cron (If using Vercel)

1. **Deploy to Vercel** (if not already deployed)
   ```bash
   vercel deploy
   ```

2. **Set environment variables in Vercel Dashboard**:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `PINECONE_API_KEY` (optional)
   - `PINECONE_INDEX_NAME` (optional)
   - `GEMINI_API_KEY`
   - `CRON_SECRET` (optional, for security)

3. **Cron is automatically configured** via `vercel.json`
   - Runs hourly during TechCrunch hours (6 AM - 10 PM Pacific)
   - No additional setup needed!

### Option 3: GitHub Actions (Free, Works Everywhere)

1. **Add secrets to GitHub** (Settings → Secrets and variables → Actions):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `PINECONE_API_KEY`
   - `PINECONE_INDEX_NAME`
   - `GEMINI_API_KEY`

2. **Push the workflow file** (already created at `.github/workflows/techcrunch-scraper.yml`)

3. **Done!** The scraper will run automatically every hour.

### Option 4: External Cron Service (cron-job.org)

1. **Deploy your Next.js app** (Vercel, Railway, etc.)

2. **Create account** at https://cron-job.org

3. **Add cron job**:
   - **URL**: `https://your-app.vercel.app/api/scrape-techcrunch`
   - **Method**: POST
   - **Schedule**: Every hour (cron: `0 * * * *`)
   - **Time Zone**: Pacific Time
   - **Headers**: 
     ```
     Authorization: Bearer your-cron-secret
     Content-Type: application/json
     ```

4. **Set `CRON_SECRET`** in your app's environment variables

## Testing

### Test locally:
```bash
# Start Next.js dev server
npm run dev

# In another terminal, test the API
curl -X POST http://localhost:3000/api/scrape-techcrunch
```

### Test deployed endpoint:
```bash
curl -X POST \
  -H "Authorization: Bearer your-cron-secret" \
  https://your-app.vercel.app/api/scrape-techcrunch
```

## What Happens

1. **Cron triggers** → Calls `/api/scrape-techcrunch` every hour
2. **API route** → Calls `scrapeAndIngestTechCrunch()`
3. **Scraper checks**:
   - ✅ Is it within active hours? (6 AM - 10 PM Pacific)
   - ✅ Has 55 minutes passed since last run?
   - ✅ Is another run in progress?
4. **If all checks pass** → Scrapes TechCrunch, extracts data, saves to Supabase + Pinecone
5. **If checks fail** → Skips gracefully with log message

## Monitoring

Check your hosting platform logs or Supabase:
```sql
SELECT COUNT(*), MAX(created_at) 
FROM startups 
WHERE data_source = 'techcrunch';
```

## Troubleshooting

**Scraper not running?**
- Check if it's within active hours (6 AM - 10 PM Pacific)
- Check logs for error messages
- Try manual trigger: `curl -X GET "https://your-app.vercel.app/api/scrape-techcrunch?force=true"`

**401 Unauthorized?**
- Set `CRON_SECRET` environment variable
- Include `Authorization: Bearer <secret>` header

**Import errors?**
- Make sure all dependencies are installed: `npm install`
- Check that `yc_companies/scrape_techcrunch_supabase_pinecone.ts` exists

