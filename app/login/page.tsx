'use client';

import { FormEvent, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirect') || '/matches';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);
    setError(null);

    try {
      if (mode === 'signin') {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) {
          throw signInError;
        }
      } else {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        });
        if (signUpError) {
          throw signUpError;
        }
        setMessage('Check your inbox to confirm your email before signing in.');
        return;
      }

      router.push(redirectTo);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-100 via-blue-50 to-white dark:from-zinc-900 dark:via-zinc-950 dark:to-black flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl bg-background/80 backdrop-blur-xl border border-border/30 shadow-2xl p-8 space-y-8">
        <div className="text-center space-y-2">
          <p className="text-sm uppercase tracking-[0.3em] text-blue-500">Welcome</p>
          <h1 className="text-3xl font-bold text-foreground">
            {mode === 'signin' ? 'Sign in to view matches' : 'Create an account'}
          </h1>
          <p className="text-sm text-muted-foreground">
            Use the same email that appears on your resume to access your personalized matches.
          </p>
        </div>

        <form className="space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              className="w-full rounded-2xl border border-border/50 bg-background px-4 py-3 text-foreground outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={6}
              className="w-full rounded-2xl border border-border/50 bg-background px-4 py-3 text-foreground outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {error && (
            <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          {message && (
            <div className="rounded-2xl border border-blue-500/40 bg-blue-500/10 px-4 py-3 text-sm text-blue-600 dark:text-blue-400">
              {message}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-base font-semibold text-white transition hover:bg-blue-700 active:bg-blue-800 disabled:cursor-not-allowed disabled:bg-blue-600/70"
          >
            {isSubmitting ? 'Please wait...' : mode === 'signin' ? 'Sign in' : 'Sign up'}
          </button>
        </form>

        <div className="text-center text-sm">
          {mode === 'signin' ? (
            <button
              className="text-blue-600 hover:underline"
              onClick={() => {
                setMode('signup');
                setError(null);
                setMessage(null);
              }}
            >
              Need an account? Sign up
            </button>
          ) : (
            <button
              className="text-blue-600 hover:underline"
              onClick={() => {
                setMode('signin');
                setError(null);
                setMessage(null);
              }}
            >
              Already have an account? Sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-blue-100 via-blue-50 to-white dark:from-zinc-900 dark:via-zinc-950 dark:to-black flex items-center justify-center">
        <div className="text-foreground">Loading...</div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}

