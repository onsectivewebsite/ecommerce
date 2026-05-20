'use client';

import * as React from 'react';
import Link from 'next/link';
import { loadStripe, type Stripe as StripeJs } from '@stripe/stripe-js';
import {
  CardElement,
  Elements,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { STRIPE_PUBLISHABLE_KEY } from '@/lib/env';

let stripePromise: Promise<StripeJs | null> | null = null;
function getStripe() {
  if (!stripePromise) stripePromise = loadStripe(STRIPE_PUBLISHABLE_KEY);
  return stripePromise;
}

const PRESETS = [2500, 5000, 10000, 25000];

export default function GiftCardsPage() {
  const { user, loading } = useAuth();

  if (loading) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!user) {
    return (
      <div className="container py-16">
        <Link href="/login?next=/gift-cards" className="ons-btn-primary">
          Sign in to buy a gift card
        </Link>
      </div>
    );
  }

  return (
    <div className="container py-10 max-w-xl">
      <h1 className="font-display text-3xl tracking-tight mb-2">Gift cards</h1>
      <p className="text-sm text-ink-400 mb-6">
        Send an Onsective gift card by email. The recipient redeems it into their wallet — it never expires.
      </p>
      {STRIPE_PUBLISHABLE_KEY ? (
        <Elements stripe={getStripe()}>
          <PurchaseForm />
        </Elements>
      ) : (
        <p className="text-danger text-sm">
          Stripe publishable key not configured. Set <code>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code>.
        </p>
      )}
      <p className="text-sm text-ink-400 mt-6">
        Have a card to redeem? <Link href="/account/gift-cards">Redeem a gift card</Link>
      </p>
    </div>
  );
}

function PurchaseForm() {
  const stripe = useStripe();
  const elements = useElements();
  const [amountMinor, setAmountMinor] = React.useState(5000);
  const [custom, setCustom] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  const effectiveAmount = custom
    ? Math.round(parseFloat(custom) * 100)
    : amountMinor;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    if (!stripe || !elements) return;
    if (!Number.isFinite(effectiveAmount) || effectiveAmount < 500 || effectiveAmount > 100_000) {
      setErr('Amount must be between $5 and $1000.');
      return;
    }
    const card = elements.getElement(CardElement);
    if (!card) return;
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const res = await api.giftCards.purchase({
        amountMinor: effectiveAmount,
        recipientEmail: String(fd.get('recipientEmail')),
        recipientName: String(fd.get('recipientName') || '') || undefined,
        senderName: String(fd.get('senderName') || '') || undefined,
        message: String(fd.get('message') || '') || undefined,
        deliverAt: String(fd.get('deliverAt') || '') || undefined,
      });
      if (!res.clientSecret) {
        setErr('Payment could not be started. Try again.');
        return;
      }
      const result = await stripe.confirmCardPayment(res.clientSecret, {
        payment_method: { card },
      });
      if (result.error) {
        setErr(result.error.message ?? 'Card declined');
        return;
      }
      setDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Purchase failed');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="ons-card">
        <h2 className="font-medium mb-2">Gift card on its way</h2>
        <p className="text-sm text-ink-400">
          Payment succeeded. We'll email the recipient their code as soon as the payment settles (usually within a minute). You can track it under{' '}
          <Link href="/account/gift-cards">your gift cards</Link>.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="ons-card space-y-4">
      <div>
        <div className="text-sm font-medium mb-2">Amount</div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setAmountMinor(p);
                setCustom('');
              }}
              className={[
                'rounded-lg px-3 py-2 text-sm border transition-colors',
                !custom && amountMinor === p
                  ? 'border-accent-400 bg-accent-500/15 text-ink-50'
                  : 'border-ink-800 text-ink-300 hover:border-ink-600',
              ].join(' ')}
            >
              ${(p / 100).toFixed(0)}
            </button>
          ))}
          <input
            type="number"
            min={5}
            max={1000}
            step={1}
            placeholder="Custom $"
            value={custom}
            onChange={(e) => setCustom(e.currentTarget.value)}
            className="w-28 bg-ink-950 border border-ink-800 rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>

      <label className="block text-sm">
        <span className="text-ink-300">Recipient email</span>
        <input
          name="recipientEmail"
          type="email"
          required
          className="mt-1 w-full bg-ink-950 border border-ink-800 rounded-lg px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        <span className="text-ink-300">Recipient name (optional)</span>
        <input
          name="recipientName"
          className="mt-1 w-full bg-ink-950 border border-ink-800 rounded-lg px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        <span className="text-ink-300">Your name (optional)</span>
        <input
          name="senderName"
          className="mt-1 w-full bg-ink-950 border border-ink-800 rounded-lg px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        <span className="text-ink-300">Message (optional)</span>
        <textarea
          name="message"
          rows={2}
          maxLength={500}
          className="mt-1 w-full bg-ink-950 border border-ink-800 rounded-lg px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        <span className="text-ink-300">Schedule delivery (optional)</span>
        <input
          name="deliverAt"
          type="datetime-local"
          className="mt-1 w-full bg-ink-950 border border-ink-800 rounded-lg px-3 py-2"
        />
        <span className="text-xs text-ink-500">Leave blank to send as soon as payment clears.</span>
      </label>

      <div>
        <div className="text-sm font-medium mb-2">Payment</div>
        <div className="border border-ink-800 rounded-lg p-3 bg-ink-950">
          <CardElement
            options={{
              style: {
                base: {
                  color: '#f4f4f4',
                  fontFamily: 'inherit',
                  fontSize: '15px',
                  '::placeholder': { color: '#6b7280' },
                },
                invalid: { color: '#f87171' },
              },
            }}
          />
        </div>
      </div>

      {err && <div className="text-danger text-sm">{err}</div>}
      <button type="submit" disabled={!stripe || busy} className="ons-btn-primary w-full">
        {busy
          ? 'Processing…'
          : `Pay $${(effectiveAmount / 100).toFixed(2)} and send`}
      </button>
    </form>
  );
}
