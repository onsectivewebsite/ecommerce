'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Badge, Button, Card, CardDescription, CardTitle, Input } from '@onsective/ui';
import type { GiftCardCheck, GiftCardRow } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'default'> = {
  ACTIVE: 'success',
  REDEEMED: 'default',
  PENDING_PAYMENT: 'warning',
  VOID: 'danger',
  EXPIRED: 'danger',
};

function money(minor: number, currency: string) {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

export default function AccountGiftCardsPage() {
  const { user, loading } = useAuth();
  const sp = useSearchParams();
  const prefilled = sp.get('code') ?? '';

  const [code, setCode] = React.useState(prefilled);
  const [check, setCheck] = React.useState<GiftCardCheck | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [redeemed, setRedeemed] = React.useState<{ creditedMinor: number; currency: string; walletBalanceMinor: number } | null>(null);
  const [mine, setMine] = React.useState<GiftCardRow[] | null>(null);

  const loadMine = React.useCallback(() => {
    api.giftCards.mine().then(setMine).catch(() => setMine([]));
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    loadMine();
  }, [loading, user, loadMine]);

  async function onCheck(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setCheck(null);
    setRedeemed(null);
    try {
      setCheck(await api.giftCards.check(code));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not check that code');
    } finally {
      setBusy(false);
    }
  }

  async function onRedeem() {
    setBusy(true);
    setErr(null);
    try {
      const res = await api.giftCards.redeem(code);
      setRedeemed(res);
      setCheck(null);
      setCode('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not redeem that code');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!user) {
    return (
      <div className="container py-16">
        <Link href="/login?next=/account/gift-cards" className="ons-btn-primary">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="container py-10 max-w-2xl space-y-8">
      <section>
        <h1 className="font-display text-3xl tracking-tight mb-6">Gift cards</h1>
        <Card>
          <CardTitle>Redeem a gift card</CardTitle>
          <CardDescription>
            Enter a code to add its balance to your wallet. Redeemed credit never expires.
          </CardDescription>

          {redeemed && (
            <div className="mt-4 rounded-lg border border-success/40 bg-success/10 p-3 text-sm">
              Added <strong>{money(redeemed.creditedMinor, redeemed.currency)}</strong> to your wallet.
              New balance: {money(redeemed.walletBalanceMinor, redeemed.currency)}.{' '}
              <Link href="/account/wallet" className="underline">View wallet</Link>
            </div>
          )}

          <form onSubmit={onCheck} className="mt-4 flex flex-col gap-3">
            <Input
              label="Gift card code"
              value={code}
              onChange={(e) => setCode(e.currentTarget.value)}
              placeholder="ONS-XXXX-XXXX-XXXX"
              required
            />
            {err && <p className="text-danger text-sm">{err}</p>}
            {check && (
              <div className="rounded-lg border border-ink-800 p-3 text-sm">
                {check.redeemable ? (
                  <>
                    This card is worth <strong>{money(check.balanceMinor, check.currency)}</strong>.
                  </>
                ) : (
                  <>This card is {check.status.toLowerCase().replace('_', ' ')} and can't be redeemed.</>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <Button type="submit" variant="ghost" loading={busy}>
                Check balance
              </Button>
              {check?.redeemable && (
                <Button type="button" onClick={onRedeem} loading={busy}>
                  Redeem to wallet
                </Button>
              )}
            </div>
          </form>
        </Card>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-2xl tracking-tight">Cards you've sent</h2>
          <Link href="/gift-cards" className="text-sm text-accent-300 hover:text-accent-200">
            Buy a gift card →
          </Link>
        </div>
        {!mine ? (
          <p className="text-ink-400 text-sm">Loading…</p>
        ) : mine.length === 0 ? (
          <p className="text-ink-400 text-sm">You haven't sent any gift cards yet.</p>
        ) : (
          <div className="space-y-2">
            {mine.map((c) => (
              <div key={c.id} className="ons-card flex items-center justify-between gap-3 text-sm">
                <div>
                  <div className="font-medium">
                    {money(c.initialAmountMinor, c.currency)} → {c.recipientEmail}
                  </div>
                  <div className="text-xs text-ink-400">
                    {c.code} · sent {new Date(c.createdAt).toLocaleDateString()}
                    {c.deliveredAt
                      ? ` · delivered ${new Date(c.deliveredAt).toLocaleDateString()}`
                      : c.deliverAt
                        ? ` · scheduled ${new Date(c.deliverAt).toLocaleDateString()}`
                        : ''}
                    {c.redeemedAt ? ` · redeemed ${new Date(c.redeemedAt).toLocaleDateString()}` : ''}
                  </div>
                </div>
                <Badge tone={STATUS_TONE[c.status] ?? 'default'}>
                  {c.status.replace('_', ' ').toLowerCase()}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
