'use client';

import { useState } from 'react';

interface ManageSubscriptionButtonProps {
  email: string;
  className?: string;
}

export function ManageSubscriptionButton({ email, className = '' }: ManageSubscriptionButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleManageSubscription = async () => {
    try {
      setLoading(true);

      // Create portal session
      const response = await fetch('/api/stripe/create-portal-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create portal session');
      }

      // Redirect to Stripe Customer Portal
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error: any) {
      console.error('Error opening portal:', error);
      alert(error.message || 'Failed to open subscription management');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleManageSubscription}
      disabled={loading}
      className={`px-4 py-2 bg-white/10 text-white border border-white/20 rounded-lg hover:bg-white/20 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {loading ? 'Loading...' : 'Manage Subscription'}
    </button>
  );
}
