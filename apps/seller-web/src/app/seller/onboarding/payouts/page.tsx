'use client';

import * as React from 'react';
import Link from 'next/link';
import type { ConnectAccountStatus, ConnectStatus } from '@onsective/api-client';
import { api } from '@/lib/api';

const STATUS_TITLE: Record<ConnectAccountStatus, string> = {
  NOT_STARTED: 'Set up payouts',
  PENDING: 'Finish payouts setup',
  RESTRICTED: 'Action needed',
  ENABLED: 'Payouts active',
  REJECTED: 'Account rejected',
  DISABLED: 'Payouts disabled',
};

const STATUS_COPY: Record<ConnectAccountStatus, string> = {
  NOT_STARTED: 'Connect a payout account with Stripe to start receiving money from your sales.',
  PENDING: 'Stripe needs a few more details before we can pay you out.',
  RESTRICTED: 'Stripe is asking for additional information. Resolve the items below to re-enable payouts.',
  ENABLED: 'Your payouts are active. Funds for completed orders are released on the next payout cycle.',
  REJECTED: 'Stripe rejected this account. Reach out to Onsective support — we may need to escalate.',
  DISABLED: 'Onsective has paused payouts on your account. Contact support for the next step.',
};

const STATUS_TONE: Record<ConnectAccountStatus, string> = {
  NOT_STARTED: 'text-ink-300',
  PENDING: 'text-warning',
  RESTRICTED: 'text-warning',
  ENABLED: 'text-success',
  REJECTED: 'text-danger',
  DISABLED: 'text-danger',
};

export default function PayoutsOnboardingPage() {
  const [status, setStatus] = React.useState<ConnectStatus | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    try {
      setStatus(await api.onboarding.status());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  React.useEffect(() => {
    void reload();
    // If we just returned from Stripe's hosted flow, the server already
    // ran sync via the return URL — refresh to pick up the new state.
    if (typeof window !== 'undefined' && window.location.search.includes('completed=1')) {
      // Small delay so the webhook also has a chance to land if needed.
      const id = setTimeout(reload, 1500);
      return () => clearTimeout(id);
    }
  }, [reload]);

  async function startOnboarding() {
    setBusy(true); setError(null);
    try {
      const r = await api.onboarding.start();
      window.location.href = r.url;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function openDashboard() {
    setBusy(true); setError(null);
    try {
      const r = await api.onboarding.loginLink();
      window.open(r.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  async function syncNow() {
    setBusy(true); setError(null);
    try {
      const s = await api.onboarding.sync();
      setStatus(s);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  if (!status) {
    if (error) return <div className="container py-16 text-danger">{error}</div>;
    return <div className="container py-16 text-ink-400">Loading…</div>;
  }

  return (
    <div className="container py-10 max-w-3xl space-y-6">
      <header>
        <h1 className="font-display text-3xl tracking-tight">Payouts</h1>
        <p className="text-ink-300 mt-2 text-sm">
          Onsective uses <a href="https://stripe.com/connect" className="underline">Stripe Connect</a> to send funds for your sales straight to your bank account.
        </p>
      </header>

      {error && <div className="ons-card border-danger/40 text-danger">{error}</div>}

      <section className="ons-card space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-ink-400">Status</div>
            <div className={`text-xl font-display ${STATUS_TONE[status.status]}`}>
              {STATUS_TITLE[status.status]}
            </div>
            <p className="text-sm text-ink-300 mt-1">{STATUS_COPY[status.status]}</p>
            {status.lastSyncedAt && (
              <p className="text-xs text-ink-500 mt-2">
                Last synced {new Date(status.lastSyncedAt).toLocaleString()}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2 items-end">
            {(status.status === 'NOT_STARTED' || status.status === 'PENDING' || status.status === 'RESTRICTED') && (
              <button onClick={startOnboarding} disabled={busy} className="ons-btn-primary">
                {busy ? 'Opening Stripe…' : status.status === 'NOT_STARTED' ? 'Set up payouts' : 'Continue onboarding'}
              </button>
            )}
            {status.status === 'ENABLED' && (
              <button onClick={openDashboard} disabled={busy} className="ons-btn-primary">
                {busy ? 'Opening…' : 'Open Stripe dashboard'}
              </button>
            )}
            <button onClick={syncNow} disabled={busy} className="ons-btn-ghost text-xs">
              {busy ? 'Syncing…' : 'Sync status'}
            </button>
          </div>
        </div>
      </section>

      {status.requirementsDue.length > 0 && (
        <section className="ons-card">
          <h2 className="font-medium mb-3">Stripe needs:</h2>
          <ul className="list-disc list-inside text-sm text-ink-300 space-y-1">
            {status.requirementsDue.map((r) => <li key={r}>{r.replaceAll('_', ' ')}</li>)}
          </ul>
          <p className="text-xs text-ink-500 mt-3">
            Click "Continue onboarding" to provide these on Stripe's hosted form.
          </p>
        </section>
      )}

      {(status.status === 'REJECTED' || status.status === 'DISABLED') && (
        <section className="ons-card text-sm">
          <p>Need help? <Link href="/support" className="underline">Contact Onsective support</Link>.</p>
        </section>
      )}
    </div>
  );
}
