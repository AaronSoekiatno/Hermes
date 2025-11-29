import { NextRequest, NextResponse } from 'next/server';
// Import the scraper function - using relative path from app/api
import { scrapeAndIngestTechCrunch } from '../../../yc_companies/scrape_techcrunch_supabase_pinecone';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max execution time (Vercel Pro plan allows up to 300s)

// For Vercel Hobby plan (10s limit), consider using a queue system or external service

/**
 * API Route for TechCrunch Scraper
 * 
 * This endpoint runs the TechCrunch scraper and can be called:
 * - Manually via HTTP request
 * - By Supabase pg_cron (hourly during TechCrunch hours)
 * - By external cron services
 * 
 * The scraper automatically checks if it's within TechCrunch's active hours
 * (6 AM - 10 PM Pacific) and skips if outside those hours.
 */
export async function POST(request: NextRequest) {
  try {
    // Optional: Add authentication check
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Run the scraper
    // Note: The scraper has built-in checks for:
    // - Active hours (6 AM - 10 PM Pacific)
    // - Minimum interval between runs (55 minutes for hourly schedule)
    // - Overlapping runs prevention
    await scrapeAndIngestTechCrunch();

    return NextResponse.json({
      success: true,
      message: 'TechCrunch scraper completed',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('TechCrunch scraper error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint for health checks and manual triggers
 */
export async function GET(request: NextRequest) {
  // Optional: Add authentication for manual triggers
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { 
        error: 'Unauthorized',
        message: 'Include Authorization header: Bearer <CRON_SECRET>'
      },
      { status: 401 }
    );
  }

  // Check if we should run (for manual triggers, we can bypass active hours check)
  const forceRun = request.nextUrl.searchParams.get('force') === 'true';
  
  if (forceRun) {
    // Run scraper even outside active hours
    try {
      await scrapeAndIngestTechCrunch();
      return NextResponse.json({
        success: true,
        message: 'TechCrunch scraper completed (forced run)',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    message: 'TechCrunch scraper API',
    endpoints: {
      POST: 'Run scraper (respects active hours)',
      'GET ?force=true': 'Force run scraper (ignores active hours)',
    },
    activeHours: '6 AM - 10 PM Pacific Time',
    schedule: 'Hourly during active hours',
  });
}

