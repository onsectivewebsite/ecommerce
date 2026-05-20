'use client';

import * as React from 'react';
import Link from 'next/link';
import type { ReferralMe } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

function shareUrl(code: string): string {
  if (typeof window === 'undefined') return `/register?ref=${code}`;
  return `${window.location.origin}/register?ref=${code}`;
}

export default function ReferralsPage() {
  const { user, loading } = useAuth();
  const [data, setData] = React.useState<ReferralMe | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (loading || !user) return;
    api.referrals.me().then(setData).catch((e) => setError((e as Error).message));
  }, [loading, user]);

  async function copy() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(shareUrl(data.code));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  if (loading) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!user) {
    return (
      <div className="container py-16">
        <Link href="/login?next=/account/referrals" className="ons-btn-primary">Sign in</Link>
      </div>
    );
  }
  if (!data) {
    if (error) return <div className="container py-16 text-danger">{error}</div>;
    return <div className="container py-16 text-ink-400">Loading referrals…</div>;
  }

  const earnedPoints = data.redemptions.reduce((s, r) => s + r.pointsAwarded, 0);

  return (
    <div className="container py-10 max-w-3xl">
      <h1 className="font-display text-3xl tracking-tight mb-2">Refer a friend</h1>
      <p className="text-ink-300 mb-6">
        Share your link. When your friend places their first paid order, you both earn{' '}
        <strong>{data.inviterRewardPoints} points</strong> — redeemable to wallet credit at 100 pts = $1.
      </p>

      <div className="ons-card mb-6">
        <div className="text-xs uppercase tracking-[0.18em] text-ink-400">Your share link</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="font-mono bg-ink-900 border border-ink-800 rounded-md px-3 py-2 text-sm flex-1 min-w-0 overflow-x-auto">
            {shareUrl(data.code)}
          </code>
          <button onClick={copy} className="ons-btn-primary text-sm whitespace-nowrap">
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>
        <div className="text-xs text-ink-400 mt-3">
          Code: <span className="font-mono">{data.code}</span>
          {data.status === 'DISABLED' && (
            <span className="ml-2 text-danger">· Disabled — contact support</span>
          )}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mb-8">
        <div className="ons-card">
          <div className="text-xs uppercase tracking-[0.18em] text-ink-400">Friends joined</div>
          <div className="text-2xl font-display mt-1">{data.totalRedemptions}</div>
        </div>
        <div className="ons-card">
          <div className="text-xs uppercase tracking-[0.18em] text-ink-400">Points earned</div>
          <div className="text-2xl font-display mt-1">{earnedPoints.toLocaleString()}</div>
        </div>
      </div>

      <h2 className="font-medium mb-3">Activity</h2>
      {data.redemptions.length === 0 ? (
        <p className="text-ink-400 text-sm">No friends yet — share your link to get started.</p>
      ) : (
        <div className="space-y-2">
          {data.redemptions.map((r) => (
            <div key={r.id} className="ons-card flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">
                  {r.inviteeFirstName}{r.inviteeInitial ? ` ${r.inviteeInitial}.` : ''} just placed their first paid order
                </div>
                <div className="text-xs text-ink-500">{new Date(r.createdAt).toLocaleString()}</div>
              </div>
              <div className="text-success">+{r.pointsAwarded.toLocaleString()} pts</div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-ink-500 mt-8">
        Terms: rewards land once your friend's first order captures. Self-referrals, same-household,
        and same-IP signups don't qualify. Limit {25} friends per rolling 30 days.
      </p>
    </div>
  );
}
