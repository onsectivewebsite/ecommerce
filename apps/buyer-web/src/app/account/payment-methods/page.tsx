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
import type { SavedPaymentMethod } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { STRIPE_PUBLISHABLE_KEY } from '@/lib/env';

let stripePromise: Promise<StripeJs | null> | null = null;
function getStripe() {
  if (!stripePromise) stripePromise = loadStripe(STRIPE_PUBLISHABLE_KEY);
  return stripePromise;
}

function brandLabel(b: string) {
  return b.charAt(0).toUpperCase() + b.slice(1);
}

export default function PaymentMethodsPage() {
  const { user, loading } = useAuth();
  const [methods, setMethods] = React.useState<SavedPaymentMethod[] | null>(null);
  const [showAdd, setShowAdd] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const reload = React.useCallback(async () => {
    try {
      setMethods(await api.paymentMethods.list());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    void reload();
  }, [loading, user, reload]);

  async function setDefault(id: string) {
    setBusy(true); setError(null);
    try {
      await api.paymentMethods.setDefault(id);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  async function detach(id: string) {
    if (!confirm('Remove this card?')) return;
    setBusy(true); setError(null);
    try {
      await api.paymentMethods.detach(id);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  if (loading) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!user) {
    return (
      <div className="container py-16">
        <Link href="/login?next=/account/payment-methods" className="ons-btn-primary">Sign in</Link>
      </div>
    );
  }
  if (!methods) return <div className="container py-16 text-ink-400">Loading payment methods…</div>;

  return (
    <div className="container py-10 max-w-2xl">
      <h1 className="font-display text-3xl tracking-tight mb-6">Payment methods</h1>

      {error && <div className="ons-card border-danger/40 text-danger mb-4">{error}</div>}

      {methods.length === 0 ? (
        <p className="text-ink-300 mb-6">No saved cards yet. Add one to enable Onsective Plus auto-renewal.</p>
      ) : (
        <ul className="space-y-2 mb-6">
          {methods.map((m) => (
            <li key={m.id} className="ons-card flex items-center justify-between flex-wrap gap-2">
              <div>
                <div className="font-medium">
                  {brandLabel(m.brand)} ···· {m.last4}
                  {m.isDefault && (
                    <span className="ml-2 text-[10px] uppercase tracking-[0.18em] text-gold-300 bg-gold-500/15 border border-gold-400/30 rounded-md px-1.5 py-0.5">
                      Default
                    </span>
                  )}
                </div>
                <div className="text-xs text-ink-400 mt-0.5">
                  Expires {String(m.expMonth).padStart(2, '0')}/{String(m.expYear).slice(-2)}
                </div>
              </div>
              <div className="flex gap-2">
                {!m.isDefault && (
                  <button onClick={() => setDefault(m.id)} disabled={busy} className="ons-btn-ghost text-xs">
                    Make default
                  </button>
                )}
                <button onClick={() => detach(m.id)} disabled={busy} className="ons-btn-ghost text-xs text-danger">
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {showAdd ? (
        <div className="ons-card">
          <h2 className="font-medium mb-3">Add a new card</h2>
          {STRIPE_PUBLISHABLE_KEY ? (
            <Elements stripe={getStripe()}>
              <AddCardForm
                onDone={async () => {
                  setShowAdd(false);
                  await reload();
                }}
                onCancel={() => setShowAdd(false)}
              />
            </Elements>
          ) : (
            <p className="text-danger text-sm">
              Stripe publishable key not configured. Set <code>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code>.
            </p>
          )}
        </div>
      ) : (
        <button onClick={() => setShowAdd(true)} className="ons-btn-primary">Add card</button>
      )}
    </div>
  );
}

function AddCardForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    const card = elements.getElement(CardElement);
    if (!card) return;
    setSubmitting(true); setError(null);
    try {
      const { clientSecret } = await api.paymentMethods.createSetupIntent();
      const result = await stripe.confirmCardSetup(clientSecret, {
        payment_method: { card },
      });
      if (result.error) {
        setError(result.error.message ?? 'Card declined');
        return;
      }
      const setupIntentId = result.setupIntent?.id;
      if (!setupIntentId) {
        setError('Stripe did not return a setup intent id');
        return;
      }
      await api.paymentMethods.attach({ setupIntentId });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
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
            hidePostalCode: false,
          }}
        />
      </div>
      {error && <div className="text-danger text-sm">{error}</div>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="ons-btn-ghost">Cancel</button>
        <button type="submit" disabled={!stripe || submitting} className="ons-btn-primary">
          {submitting ? 'Saving…' : 'Save card'}
        </button>
      </div>
    </form>
  );
}
