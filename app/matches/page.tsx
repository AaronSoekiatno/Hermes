import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase';

interface MatchRecord {
  id: string;
  score: number;
  matched_at: string;
  startup: {
    name: string;
    industry: string;
    location: string;
    funding_stage: string;
    funding_amount: string;
    tags: string;
    website: string;
    founder_emails?: string;
  } | null;
}

export default async function MatchesPage() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables are not configured.');
  }

  const cookieStore = (await cookies()) as Awaited<ReturnType<typeof cookies>>;
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {},
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?redirect=/matches`);
  }

  if (!supabaseAdmin) {
    throw new Error('Supabase service role key is not configured.');
  }

  const { data: matches, error } = await supabaseAdmin
    .from('matches')
    .select(
      `
        id,
        score,
        matched_at,
        startup:startups (
          name,
          industry,
          location,
          funding_stage,
          funding_amount,
          tags,
          website,
          founder_emails
        )
      `
    )
    .eq('candidate_email', user.email ?? '')
    .order('score', { ascending: false });

  if (error) {
    throw new Error(`Failed to load matches: ${error.message}`);
  }

  const typedMatches = ((matches ?? []) as unknown) as MatchRecord[];

  return (
    <section className="min-h-screen bg-gradient-to-br from-blue-100 via-blue-50 to-white dark:from-zinc-900 dark:via-zinc-950 dark:to-black py-20">
      <div className="container mx-auto px-4 space-y-10">
        <div className="text-center space-y-3">
          <p className="text-sm uppercase tracking-[0.3em] text-blue-500">Your Matches</p>
          <h1 className="text-4xl font-bold text-foreground">Startups excited to meet you</h1>
          <p className="text-muted-foreground">
            {typedMatches.length > 0
              ? `Showing ${typedMatches.length} matched startup${
                  typedMatches.length === 1 ? '' : 's'
                }.`
              : 'Upload a resume to see personalized startup matches.'}
          </p>
        </div>

        {typedMatches.length > 0 ? (
          <div className="grid gap-6 md:grid-cols-2">
            {typedMatches.map((match) => (
              <article
                key={match.id}
                className="rounded-3xl border border-border/40 bg-background/80 backdrop-blur-xl p-6 shadow-lg"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-semibold text-foreground">
                      {match.startup?.name ?? 'Unknown Startup'}
                    </h2>
                    <p className="text-sm text-muted-foreground">{match.startup?.industry}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">Match score</p>
                    <p className="text-2xl font-bold text-blue-600">
                      {(match.score * 100).toFixed(0)}%
                    </p>
                  </div>
                </div>

                <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                  {match.startup?.location && <p>Location: {match.startup.location}</p>}
                  {match.startup?.funding_stage && (
                    <p>
                      Funding: {match.startup.funding_stage}{' '}
                      {match.startup.funding_amount && `• ${match.startup.funding_amount}`}
                    </p>
                  )}
                  {match.startup?.tags && (
                    <p className="text-xs uppercase tracking-widest text-foreground/60">
                      {match.startup.tags}
                    </p>
                  )}
                </div>

                <div className="mt-6 flex flex-wrap gap-3">
                  {match.startup?.website && (
                    <a
                      href={match.startup.website.startsWith('http')
                        ? match.startup.website
                        : `https://${match.startup.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-2xl border border-border px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-foreground/5"
                    >
                      Visit website
                    </a>
                  )}
                  {match.startup?.founder_emails && (
                    <a
                      href={`mailto:${match.startup.founder_emails}`}
                      className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                    >
                      Email founder
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-3xl border border-border/40 bg-background/80 backdrop-blur-xl p-12 text-center text-muted-foreground">
            No matches yet. Upload your resume to get started.
          </div>
        )}
      </div>
    </section>
  );
}

