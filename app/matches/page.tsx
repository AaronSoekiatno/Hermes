'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { MatchCard } from '@/components/MatchCard';
import { Header } from '@/components/Header';
import { ManageSubscriptionButton } from '@/components/ManageSubscriptionButton';
import { UpgradeModalWrapper } from '@/components/UpgradeModalWrapper';
import { isSubscribed } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';

interface MatchRecord {
  id: string;
  score: number;
  matched_at: string;
  startup: {
    id?: string;
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

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export default function MatchesPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [candidate, setCandidate] = useState<any>(null);
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [hasError, setHasError] = useState(false);
  const observerTarget = useRef<HTMLDivElement>(null);

  // Load initial data
  useEffect(() => {
    const initialize = async () => {
      try {
        const { data: { user: currentUser }, error: authError } = await supabase.auth.getUser();
        
        if (authError || !currentUser) {
          router.push(`/?signup=true&redirect=/matches`);
          return;
        }

        setUser(currentUser);

        // Get candidate info
        const response = await fetch('/api/matches?page=1&limit=6', {
          credentials: 'include',
        });

        if (!response.ok) {
          if (response.status === 404) {
            router.push('/?error=no_resume');
            return;
          }
          throw new Error('Failed to load matches');
        }

        const data = await response.json();
        setMatches(data.matches || []);
        setPagination(data.pagination);

        // Get candidate subscription info for display
        const candidateResponse = await fetch('/api/candidate-info', {
          credentials: 'include',
        });
        if (candidateResponse.ok) {
          const candidateData = await candidateResponse.json();
          setCandidate(candidateData);
        }
      } catch (error) {
        console.error('Error initializing matches page:', error);
        setHasError(true);
      } finally {
        setIsLoading(false);
      }
    };

    initialize();
  }, [router]);

  // Load more matches
  const loadMoreMatches = useCallback(async () => {
    if (!pagination?.hasMore || isLoadingMore) return;

    setIsLoadingMore(true);
    try {
      const nextPage = pagination.page + 1;
      const response = await fetch(`/api/matches?page=${nextPage}&limit=6`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to load more matches');
      }

      const data = await response.json();
      setMatches((prev) => [...prev, ...(data.matches || [])]);
      setPagination(data.pagination);
    } catch (error) {
      console.error('Error loading more matches:', error);
    } finally {
      setIsLoadingMore(false);
    }
  }, [pagination, isLoadingMore]);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && pagination?.hasMore && !isLoadingMore) {
          loadMoreMatches();
        }
      },
      { threshold: 0.1 }
    );

    const currentTarget = observerTarget.current;
    if (currentTarget) {
      observer.observe(currentTarget);
    }

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget);
      }
    };
  }, [pagination, isLoadingMore, loadMoreMatches]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-900 dark:from-zinc-900 dark:via-zinc-950 dark:to-black">
        <Header initialUser={user} />
        <section className="py-20">
          <div className="container mx-auto px-4">
            <div className="text-center text-white">
              <p>Loading matches...</p>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (hasError || !user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-900 dark:from-zinc-900 dark:via-zinc-950 dark:to-black">
        <Header initialUser={user} />
        <section className="py-20">
          <div className="container mx-auto px-4">
            <div className="text-center text-white">
              <p>Failed to load matches. Please try again.</p>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const isPremium = candidate ? isSubscribed(candidate) : false;
  const isFree = !isPremium;
  const hasMatches = matches.length > 0;

  // For free users, limit to 1 match
  const displayedMatches = isFree ? matches.slice(0, 1) : matches;
  const hiddenMatchCount = isFree ? Math.max(0, (pagination?.total || 0) - 1) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-indigo-900 dark:from-zinc-900 dark:via-zinc-950 dark:to-black">
      <Header initialUser={user} />
      <section className="py-20">
        <div className="container mx-auto px-4 space-y-10">
          <div className="text-center space-y-4">
            <div className="flex items-center justify-center gap-4 flex-wrap">
              <h1 className="text-4xl md:text-5xl font-bold text-blue-300">Startups excited to meet you</h1>
            </div>
            <p className="text-white/90 text-lg">
              {hasMatches
                ? isPremium
                  ? `Congrats! You matched with ${pagination?.total || matches.length} startup${
                      (pagination?.total || matches.length) === 1 ? '' : 's'
                    }! Review your matches and send personalized emails.`
                  : `You matched with ${pagination?.total || matches.length} startup${
                      (pagination?.total || matches.length) === 1 ? '' : 's'
                    }! Upgrade to Premium to see all matches and unlock premium features.`
                : 'Upload a resume to see personalized startup matches.'}
            </p>
            {isPremium && candidate?.stripe_customer_id && (
              <ManageSubscriptionButton email={user.email ?? ''} />
            )}
          </div>

          {/* Free tier upgrade modal */}
          <UpgradeModalWrapper
            shouldShow={hasMatches && isFree}
            hiddenMatchCount={hiddenMatchCount}
            email={user.email ?? ''}
          />

          {hasMatches ? (
            <div>
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {displayedMatches.map((match) => (
                  <MatchCard key={match.id} match={match} />
                ))}
                
                {/* Blurred preview of additional matches (free tier only) */}
                {isFree && hiddenMatchCount > 0 && (
                  <>
                    {matches.slice(1, Math.min(10, matches.length)).map((match) => (
                      <div key={match.id} className="blur-md pointer-events-none select-none opacity-60">
                        <MatchCard match={match} />
                      </div>
                    ))}
                  </>
                )}
              </div>

              {/* Loading indicator for infinite scroll */}
              {isPremium && pagination?.hasMore && (
                <div ref={observerTarget} className="py-8 text-center">
                  {isLoadingMore ? (
                    <p className="text-white/70">Loading more matches...</p>
                  ) : (
                    <div className="h-20" /> // Spacer for intersection observer
                  )}
                </div>
              )}

              {/* End of results */}
              {isPremium && !pagination?.hasMore && matches.length > 0 && (
                <div className="py-8 text-center">
                  <p className="text-white/70">You've seen all your matches!</p>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-3xl border border-white/20 bg-white/10 backdrop-blur-xl p-12 text-center text-white">
              <p className="text-lg text-white">No matches yet. Upload your resume to get started.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
