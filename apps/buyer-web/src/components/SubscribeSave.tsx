'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Money } from '@onsective/ui';
import type { CurrencyCode, ProductDetailDto } from '@onsective/shared-types';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const DISCOUNT_BPS = 500;
const INTERVALS = [
  { days: 30, label: 'Every month' },
  { days: 60, label: 'Every 2 months' },
  { days: 90, label: 'Every 3 months' },
];

export function SubscribeSave({ product }: { product: ProductDetailDto }) {
  const router = useRouter();
  const { user } = useAuth();
  const variant = product.variants[0];
  const [intervalDays, setIntervalDays] = React.useState(30);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Subscribe & Save is for physical, replenishable new goods only —
  // not digital, and not one-of-a-kind refurbished units.
  if (!variant || product.compliance?.isDigital) return null;
  if (product.condition && product.condition !== 'NEW_GENUINE') return null;

  const unit = variant.priceMinor;
  const discountedUnit = unit - Math.round((unit * DISCOUNT_BPS) / 10000);
  const currency = product.currency as CurrencyCode;

  async function subscribe() {
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(`/p/${product.slug}`)}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const addresses = await api.orders.listMyAddresses();
      const address = addresses.find((a) => a.isDefault) ?? addresses[0];
      if (!address) {
        setError('Add a shipping address in your account before subscribing.');
        return;
      }
      await api.autoship.subscribe({
        variantId: variant!.id,
        qty: 1,
        intervalDays,
        shippingAddressId: address.id,
      });
      setDone(true);
    } catch {
      setError('Could not start the subscription. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ons-card border-accent-500/30">
      <div className="flex items-center justify-between">
        <h3 className="text-sm uppercase tracking-wider text-accent-300">Subscribe &amp; Save 5%</h3>
        <Money amountMinor={discountedUnit} currency={currency} />
      </div>
      <p className="text-sm text-ink-400 mt-1">
        Auto-delivered on your schedule. Skip, pause, or cancel anytime.
      </p>
      {done ? (
        <p className="mt-3 text-sm text-success">
          Subscription started — manage it under{' '}
          <a href="/account/subscriptions" className="underline">My subscriptions</a>.
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <select
            value={intervalDays}
            onChange={(e) => setIntervalDays(Number(e.target.value))}
            className="ons-input"
            aria-label="Delivery frequency"
          >
            {INTERVALS.map((i) => (
              <option key={i.days} value={i.days}>{i.label}</option>
            ))}
          </select>
          <button type="button" disabled={busy} onClick={subscribe} className="ons-btn-secondary text-sm">
            {busy ? 'Starting…' : 'Subscribe & Save'}
          </button>
          {error && <span className="text-danger text-sm">{error}</span>}
        </div>
      )}
    </div>
  );
}
