"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase, isSubscribed } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { UpgradeModal } from "@/components/UpgradeModal";
import { ManageSubscriptionButton } from "@/components/ManageSubscriptionButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import logo from "../images/hermeslogo.png";

interface HeaderProps {
  initialUser?: User | null;
}

export const Header = ({ initialUser }: HeaderProps) => {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(initialUser ?? null);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [isPremium, setIsPremium] = useState(false);
  const { toast } = useToast();

  // Fetch candidate info to check premium status
  useEffect(() => {
    const fetchCandidateInfo = async () => {
      if (!user?.email) {
        setIsPremium(false);
        return;
      }

      try {
        const response = await fetch('/api/candidate-info', {
          credentials: 'include',
        });
        if (response.ok) {
          const candidateInfo = await response.json();
          setIsPremium(isSubscribed(candidateInfo));
        } else {
          setIsPremium(false);
        }
      } catch (error) {
        console.error('Error fetching candidate info:', error);
        setIsPremium(false);
      }
    };

    fetchCandidateInfo();
  }, [user]);

  useEffect(() => {
    // Sync with auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return (
    <header className="sticky top-0 z-50 w-full backdrop-blur-xl bg-white/10 border-b border-white/20">
      <div className="container mx-auto px-8 py-3 flex items-center justify-between">
        {/* Logo and Title */}
        <Link href="/" className="flex items-center gap-3">
          <Image
            src={logo}
            alt="Hermes logo"
            className="h-9 w-auto rounded-lg"
            priority
          />
          <span className="text-white font-semibold text-2xl">Hermes</span>
        </Link>

        {/* Sign In Button / Account Indicator */}
        <div className="flex items-center gap-1">
          {user ? (
            <>
              <button
                onClick={() => {
                  console.log('Matches link clicked, navigating to /matches');
                  router.push('/matches');
                }}
                className="text-md font-semibold text-white transition-all border border-transparent hover:border-white/30 hover:bg-white/10 hover:rounded-xl hover:px-3 hover:py-1.5 px-3 py-1.5 focus:outline-none"
              >
                Your Matches
              </button>
              <Link
                href="/history"
                className="text-md font-semibold text-white transition-all border border-transparent hover:border-white/30 hover:bg-white/10 hover:rounded-xl hover:px-3 hover:py-1.5 px-3 py-1.5 focus:outline-none"
              >
                History
              </Link>
              <button
                onClick={async () => {
                  // Sync subscription status before opening modal
                  if (user?.email) {
                    try {
                      console.log('Syncing subscription status...');
                      const syncResponse = await fetch('/api/stripe/sync-subscription', {
                        method: 'POST',
                        credentials: 'include',
                      });
                      
                      if (!syncResponse.ok) {
                        let errorData;
                        const text = await syncResponse.text();
                        try {
                          errorData = text ? JSON.parse(text) : { error: 'Unknown error' };
                        } catch (parseError) {
                          errorData = { 
                            error: `HTTP ${syncResponse.status}: ${syncResponse.statusText}`,
                            message: text || 'Failed to read error response'
                          };
                        }
                        console.error('Sync failed:', errorData);
                        toast({
                          title: "Sync failed",
                          description: errorData.error || errorData.message || 'Failed to sync subscription status',
                          variant: "destructive",
                        });
                      } else {
                        const syncData = await syncResponse.json();
                        console.log('Sync result:', syncData);
                      }
                      
                      // Refresh candidate info after sync
                      const response = await fetch('/api/candidate-info', {
                        credentials: 'include',
                        cache: 'no-store', // Ensure fresh data
                      });
                      if (response.ok) {
                        const candidateInfo = await response.json();
                        console.log('Candidate info after sync:', candidateInfo);
                        setIsPremium(isSubscribed(candidateInfo));
                      } else {
                        console.error('Failed to fetch candidate info');
                      }
                    } catch (error) {
                      console.error('Error syncing subscription:', error);
                    }
                  }
                  setShowPremiumModal(true);
                }}
                className="text-md font-semibold text-white transition-all border border-transparent hover:border-white/30 hover:bg-white/10 hover:rounded-xl hover:px-3 hover:py-1.5 px-3 py-1.5 focus:outline-none"
              >
                Premium
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-2 text-white transition-all border border-transparent hover:border-white/30 hover:bg-white/10 hover:rounded-xl hover:px-3 hover:py-1.5 px-3 py-1.5 focus:outline-none">
                    <div className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center font-semibold text-xs">
                      {user.email?.[0]?.toUpperCase() ?? "U"}
                    </div>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="border-white/30 bg-white/10 text-white px-0 py-0 rounded-2xl overflow-hidden min-w-[200px]">
                  <div className="px-4 py-2 text-sm text-white/80 border-b border-white/10">
                    {user.email}
                  </div>
                  {isPremium && (
                    <div className="px-4 py-2 border-b border-white/10">
                      <ManageSubscriptionButton 
                        email={user.email ?? ''} 
                        className="w-full"
                      />
                    </div>
                  )}
                  <DropdownMenuItem
                    className="cursor-pointer text-white w-full px-4 py-2 text-center hover:bg-white/20 focus:bg-white/20"
                    onSelect={async () => {
                      await supabase.auth.signOut();
                      setUser(null);
                      toast({
                        title: "Signed out",
                        description: "You have been signed out successfully.",
                      });
                    }}
                  >
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <div className="flex items-center gap-4">
              <Link
                href="/"
                className="text-sm font-semibold text-white transition-all border border-transparent hover:border-white/30 hover:bg-white/10 hover:rounded-xl hover:px-3 hover:py-1.5 px-3 py-1.5 focus:outline-none"
              >
                Sign In
              </Link>
              <Link
                href="/"
                className="text-sm font-semibold text-white transition-all border border-transparent hover:border-white/30 hover:bg-white/10 hover:rounded-xl hover:px-3 hover:py-1.5 px-3 py-1.5 focus:outline-none"
              >
                Sign Up
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Premium Modal */}
      <UpgradeModal
        open={showPremiumModal}
        onOpenChange={setShowPremiumModal}
        hiddenMatchCount={0}
        email={user?.email || ''}
        onDismiss={() => setShowPremiumModal(false)}
        customTitle="Our Premium Plan"
        isPremium={isPremium}
      />
    </header>
  );
};

