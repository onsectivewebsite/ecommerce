'use client';

import * as React from 'react';
import Link from 'next/link';
import { Money } from '@onsective/ui';
import type {
  MembershipPlan,
  MembershipResponse,
  SavedPaymentMethod,
} from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function brandLabel(b: string) {
  return b.charAt(0).toUpperCase() + b.slice(1);
}

export default function MembershipPage() {
  const { user, loading } = useAuth();
  const [data, setData] = React.useState<MembershipResponse | null>(null);
  const [methods, setMethods] = React.useState<SavedPaymentMethod[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    try {
      const [r, m] = await Promise.all([
        api.loyalty.myMembership(),
        api.paymentMethods.list(),
      ]);
      setData(r);
      setMethods(m);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    void reload();
  }, [loading, user, reload]);

  async function start(plan: MembershipPlan) {
    setBusy(true); setError(null);
    try {
      await api.loyalty.startMembership({ plan });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  async function setAutoRenew(on: boolean) {
    setBusy(true); setError(null);
    try {
      await api.loyalty.setAutoRenew(on);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  async function cancel() {
    if (!confirm('Turn off auto-renew? Your Plus benefits will stay until the end of the current term.')) return;
    setBusy(true); setError(null);
    try {
      await api.loyalty.cancelMembership({});
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  if (loading) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!user) {
    return (
      <div className="container py-16">
        <Link href="/login?next=/account/membership" className="ons-btn-primary">Sign in</Link>
      </div>
    );
  }
  if (!data || !methods) return <div className="container py-16 text-ink-400">Loading membership…</div>;

  const m = data.membership;
  const defaultCard = methods.find((x) => x.isDefault) ?? null;
  const isActive = !!m && m.status === 'ACTIVE' && new Date(m.expiresAt).getTime() > Date.now();
  const isPaused = !!m && m.status === 'PAUSED';

  return (
    <div className="container py-10 max-w-3xl">
      <h1 className="font-display text-3xl tracking-tight mb-2">Onsective Plus</h1>
      <p className="text-ink-300 mb-6">Free shipping, extended warranty on refurbs, early access to the Outlet, and 1.5× points.</p>

      {error && <div className="ons-card border-danger/40 text-danger mb-4">{error}</div>}

      {!m && (
        <>
          {!defaultCard && (
            <div className="ons-card mb-4 border-warning/40">
              <p className="text-sm">
                You need a saved card before joining — auto-renewal will use it each term.{' '}
                <Link href="/account/payment-methods" className="underline">Add a card</Link>
              </p>
            </div>
          )}
          <div className="grid md:grid-cols-2 gap-4">
            <PlanCard
              title="Plus Annual"
              priceMinor={7900}
              badge="Best value"
              sub="Billed once a year."
              disabled={busy || !defaultCard}
              onClick={() => start('PLUS_ANNUAL')}
            />
            <PlanCard
              title="Plus Monthly"
              priceMinor={999}
              sub="Cancel anytime."
              disabled={busy || !defaultCard}
              onClick={() => start('PLUS_MONTHLY')}
            />
          </div>
        </>
      )}

      {m && (
        <div className="ons-card mb-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-ink-400">Status</div>
              <div className="text-xl font-display">
                {isActive
                  ? m.autoRenew ? 'Active' : 'Active — auto-renew off'
                  : isPaused
                    ? 'Paused — payment failed, please update your card'
                    : m.status.toLowerCase()}
              </div>
              <div className="text-sm text-ink-300 mt-1">
                {m.plan === 'PLUS_ANNUAL' ? 'Annual' : 'Monthly'} ·{' '}
                <Money amountMinor={m.pricePaidMinor} currency={m.currency} /> ·{' '}
                {m.autoRenew ? 'Renews ' : 'Expires '}
                {fmtDate(m.currentPeriodEnd ?? m.expiresAt)}
              </div>
              {defaultCard && (
                <div className="text-xs text-ink-400 mt-2">
                  Pays with {brandLabel(defaultCard.brand)} ···· {defaultCard.last4} ·{' '}
                  <Link href="/account/payment-methods" className="underline">Manage cards</Link>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2 items-end">
              {(isActive || isPaused) && m.autoRenew && (
                <button onClick={cancel} disabled={busy} className="ons-btn-ghost text-danger">
                  {busy ? 'Working…' : 'Turn off auto-renew'}
                </button>
              )}
              {(isActive || isPaused) && !m.autoRenew && (
                <button onClick={() => setAutoRenew(true)} disabled={busy} className="ons-btn-primary">
                  {busy ? 'Working…' : 'Re-enable auto-renew'}
                </button>
              )}
              {!isActive && !isPaused && (
                <button onClick={() => start(m.plan)} disabled={busy || !defaultCard} className="ons-btn-primary">
                  {busy ? 'Working…' : 'Renew'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <h2 className="font-medium mt-8 mb-3">Benefits</h2>
      <ul className="grid sm:grid-cols-2 gap-3 text-sm">
        <li className="ons-card">Free shipping on every order</li>
        <li className="ons-card">+{data.benefits.extendedWarrantyMonths} months refurb warranty</li>
        <li className="ons-card">Early access to Outlet listings</li>
        <li className="ons-card">{data.benefits.pointsMultiplier}× points on every purchase</li>
      </ul>
    </div>
  );
}

function PlanCard({
  title, priceMinor, sub, badge, disabled, onClick,
}: {
  title: string;
  priceMinor: number;
  sub: string;
  badge?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="ons-card">
      {badge && (
        <div className="inline-block text-[10px] uppercase tracking-[0.18em] text-gold-300 bg-gold-500/15 border border-gold-400/30 rounded-md px-1.5 py-0.5 mb-2">
          {badge}
        </div>
      )}
      <div className="font-display text-xl">{title}</div>
      <div className="text-2xl font-display mt-1"><Money amountMinor={priceMinor} currency="USD" emphasized /></div>
      <div className="text-sm text-ink-300 mt-1">{sub}</div>
      <button onClick={onClick} disabled={disabled} className="ons-btn-primary mt-4 w-full">
        {disabled ? 'Add a card first' : 'Join Plus'}
      </button>
    </div>
  );
}
