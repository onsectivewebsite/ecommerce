'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Card, CardTitle, Input, Money } from '@onsective/ui';
import type { AddressDto, ShippingQuoteOption, ShippingQuoteResponse } from '@onsective/shared-types';
import type { SavedPaymentMethod } from '@onsective/api-client';
import { loadStripe, type Stripe as StripeJs } from '@stripe/stripe-js';
import { useAuth } from '@/lib/auth-context';
import { useCart } from '@/lib/cart-context';
import { api } from '@/lib/api';
import { STRIPE_PUBLISHABLE_KEY } from '@/lib/env';

let stripeJsPromise: Promise<StripeJs | null> | null = null;
function getStripeJs() {
  if (!stripeJsPromise) stripeJsPromise = loadStripe(STRIPE_PUBLISHABLE_KEY);
  return stripeJsPromise;
}

function brandLabel(b: string) {
  return b.charAt(0).toUpperCase() + b.slice(1);
}

export default function CheckoutPage() {
  const { user, loading: authLoading } = useAuth();
  const { cart, refresh } = useCart();
  const router = useRouter();

  const [addresses, setAddresses] = React.useState<AddressDto[]>([]);
  const [selectedAddr, setSelectedAddr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [provider, setProvider] = React.useState<'mock' | 'stripe'>('mock');
  const [showAddress, setShowAddress] = React.useState(false);
  const [savedCards, setSavedCards] = React.useState<SavedPaymentMethod[]>([]);
  const [savedPaymentMethodId, setSavedPaymentMethodId] = React.useState<string | null>(null);

  const [quotes, setQuotes] = React.useState<ShippingQuoteResponse | null>(null);
  const [chosen, setChosen] = React.useState<ShippingQuoteOption | null>(null);
  const [quoting, setQuoting] = React.useState(false);

  const [promoCode, setPromoCode] = React.useState('');
  const [appliedCodes, setAppliedCodes] = React.useState<string[]>([]);
  const [walletBalance, setWalletBalance] = React.useState(0);
  const [walletApply, setWalletApply] = React.useState(0);

  React.useEffect(() => {
    if (!authLoading && !user) router.push('/login?next=/checkout');
  }, [authLoading, user, router]);

  React.useEffect(() => {
    if (!user) return;
    api.orders.listMyAddresses().then((list) => {
      setAddresses(list);
      const def = list.find((a) => a.isDefault) ?? list[0];
      if (def) setSelectedAddr(def.id);
      else setShowAddress(true);
    });
    api.wallet.statement().then((s) => setWalletBalance(s.balanceMinor)).catch(() => undefined);
    api.paymentMethods.list().then((list) => {
      setSavedCards(list);
      const def = list.find((m) => m.isDefault) ?? list[0];
      if (def) {
        setSavedPaymentMethodId(def.id);
        setProvider('stripe');
      }
    }).catch(() => undefined);
  }, [user]);

  React.useEffect(() => {
    if (!user || !selectedAddr) { setQuotes(null); setChosen(null); return; }
    setQuoting(true);
    api.shipping.quote(selectedAddr)
      .then((res) => {
        setQuotes(res);
        const cheapest = [...res.options].sort((a, b) => a.amountMinor - b.amountMinor)[0] ?? null;
        setChosen(cheapest);
      })
      .catch(() => { setQuotes(null); setChosen(null); })
      .finally(() => setQuoting(false));
  }, [user, selectedAddr]);

  async function placeOrder() {
    if (!selectedAddr) { setErr('Please select or add a shipping address.'); return; }
    setBusy(true); setErr(null);
    try {
      const usingSavedCard = provider === 'stripe' && !!savedPaymentMethodId;
      let order;
      try {
        const res = await api.orders.checkout({
          shippingAddressId: selectedAddr,
          paymentProvider: provider,
          shippingCarrier: chosen?.carrier,
          shippingService: chosen?.serviceLevel,
          shippingAmountMinor: chosen?.amountMinor,
          promotionCodes: appliedCodes,
          walletAmountMinor: walletApply,
          savedPaymentMethodId: usingSavedCard ? savedPaymentMethodId! : undefined,
        });
        order = res.order;
      } catch (e) {
        // Phase 24: SCA reflow. API surfaces code=PAYMENT_AUTHENTICATION_REQUIRED
        // with details={ clientSecret, order } via 409 — confirm card payment
        // client-side, then the existing webhook captures the order.
        const err = e as { code?: string; details?: { clientSecret?: string; order?: { id: string } } };
        if (err.code === 'PAYMENT_AUTHENTICATION_REQUIRED' && err.details?.clientSecret && err.details.order) {
          const stripe = await getStripeJs();
          if (!stripe) throw new Error('Stripe.js failed to load');
          const result = await stripe.confirmCardPayment(err.details.clientSecret);
          if (result.error) {
            throw new Error(result.error.message ?? 'Card authentication failed');
          }
          order = err.details.order;
        } else {
          throw e;
        }
      }
      if (provider === 'mock') {
        await api.orders.mockCapture(order.id);
      }
      await refresh();
      router.push(`/orders/${order.id}?placed=1`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Checkout failed');
    } finally { setBusy(false); }
  }

  async function addAddress(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const created = await api.orders.createAddress({
      fullName: String(fd.get('fullName')),
      line1: String(fd.get('line1')),
      city: String(fd.get('city')),
      region: String(fd.get('region')),
      postalCode: String(fd.get('postalCode')),
      country: String(fd.get('country')),
      phone: String(fd.get('phone') ?? '') || undefined,
      isDefault: addresses.length === 0,
    });
    setAddresses((a) => [created, ...a]);
    setSelectedAddr(created.id);
    setShowAddress(false);
  }

  if (authLoading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!cart || cart.items.length === 0) {
    return (
      <div className="container py-16 text-center">
        <h1 className="font-display text-2xl">Your cart is empty</h1>
        <Link href="/" className="ons-btn-primary mt-6 inline-flex">Browse</Link>
      </div>
    );
  }

  const shippingMinor = chosen?.amountMinor ?? quotes?.flat.amountMinor ?? 0;
  const tax = Math.round(((cart.subtotalMinor + shippingMinor) * 800) / 10000);
  const total = cart.subtotalMinor + shippingMinor + tax;

  return (
    <div className="container py-10 grid md:grid-cols-[1fr_360px] gap-8">
      <div className="space-y-6">
        <Card>
          <CardTitle>1. Shipping address</CardTitle>
          <div className="mt-4 space-y-2">
            {addresses.map((a) => (
              <label key={a.id} className={[
                'block ons-card p-4 cursor-pointer',
                a.id === selectedAddr ? 'border-accent-500/60 bg-accent-500/5' : '',
              ].join(' ')}>
                <input type="radio" name="addr" className="mr-2" checked={a.id === selectedAddr} onChange={() => setSelectedAddr(a.id)} />
                <span className="font-medium">{a.fullName}</span>
                <div className="text-ink-300 text-sm mt-1">
                  {a.line1}{a.line2 ? `, ${a.line2}` : ''}, {a.city}, {a.region} {a.postalCode}, {a.country}
                </div>
              </label>
            ))}
            <button onClick={() => setShowAddress((v) => !v)} className="text-sm text-accent-300 mt-2">
              {showAddress ? 'Cancel' : '+ Add new address'}
            </button>
          </div>
          {showAddress && (
            <form onSubmit={addAddress} className="mt-4 grid grid-cols-2 gap-3">
              <Input className="col-span-2" label="Full name" name="fullName" required />
              <Input className="col-span-2" label="Street line 1" name="line1" required />
              <Input label="City" name="city" required />
              <Input label="Region / State" name="region" required />
              <Input label="Postal code" name="postalCode" required />
              <Input label="Country (ISO-2)" name="country" required maxLength={2} defaultValue="US" />
              <Input className="col-span-2" label="Phone" name="phone" />
              <div className="col-span-2"><Button type="submit" variant="secondary">Save address</Button></div>
            </form>
          )}
        </Card>

        <Card>
          <CardTitle>2. Shipping method</CardTitle>
          {quoting ? (
            <p className="mt-3 text-ink-400 text-sm">Fetching live carrier rates…</p>
          ) : !quotes || quotes.options.length === 0 ? (
            <p className="mt-3 text-ink-400 text-sm">No carrier options — using platform flat rate.</p>
          ) : (
            <div className="mt-4 space-y-2">
              {[...quotes.options]
                .sort((a, b) => a.amountMinor - b.amountMinor)
                .map((q) => (
                  <label key={`${q.carrier}-${q.serviceLevel}`} className={[
                    'flex items-center gap-3 ons-card p-4 cursor-pointer',
                    chosen?.serviceLevel === q.serviceLevel && chosen?.carrier === q.carrier ? 'border-accent-500/60 bg-accent-500/5' : '',
                  ].join(' ')}>
                    <input
                      type="radio"
                      checked={chosen?.serviceLevel === q.serviceLevel && chosen?.carrier === q.carrier}
                      onChange={() => setChosen(q)}
                    />
                    <div className="flex-1">
                      <div className="font-medium">{q.serviceDisplayName}</div>
                      <div className="text-xs text-ink-400">
                        {q.carrier.toUpperCase()} · est. {q.estimatedDeliveryDays} day{q.estimatedDeliveryDays === 1 ? '' : 's'}
                        {q.degraded ? ' · estimated' : ''}
                      </div>
                    </div>
                    <Money amountMinor={q.amountMinor} currency={cart.currency} />
                  </label>
                ))}
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>3. Payment</CardTitle>
          <div className="mt-4 space-y-2">
            {savedCards.length > 0 && savedCards.map((c) => (
              <label key={c.id} className={[
                'block ons-card p-4 cursor-pointer',
                provider === 'stripe' && savedPaymentMethodId === c.id ? 'border-accent-500/60 bg-accent-500/5' : '',
              ].join(' ')}>
                <input
                  type="radio"
                  className="mr-2"
                  checked={provider === 'stripe' && savedPaymentMethodId === c.id}
                  onChange={() => { setProvider('stripe'); setSavedPaymentMethodId(c.id); }}
                />
                <span className="font-medium">{brandLabel(c.brand)} ···· {c.last4}</span>
                {c.isDefault && (
                  <span className="ml-2 text-[10px] uppercase tracking-[0.18em] text-gold-300 bg-gold-500/15 border border-gold-400/30 rounded-md px-1.5 py-0.5">
                    Default
                  </span>
                )}
                <div className="text-ink-400 text-xs mt-1">
                  Expires {String(c.expMonth).padStart(2, '0')}/{String(c.expYear).slice(-2)}
                </div>
              </label>
            ))}
            <label className={[
              'block ons-card p-4 cursor-pointer',
              provider === 'mock' ? 'border-accent-500/60 bg-accent-500/5' : '',
            ].join(' ')}>
              <input
                type="radio"
                className="mr-2"
                checked={provider === 'mock'}
                onChange={() => { setProvider('mock'); setSavedPaymentMethodId(null); }}
              />
              <span className="font-medium">Onsective Pay (test)</span>
              <div className="text-ink-400 text-sm">Instant approval — for development & QA.</div>
            </label>
            <label className={[
              'block ons-card p-4 cursor-pointer',
              provider === 'stripe' && !savedPaymentMethodId ? 'border-accent-500/60 bg-accent-500/5' : '',
            ].join(' ')}>
              <input
                type="radio"
                className="mr-2"
                checked={provider === 'stripe' && !savedPaymentMethodId}
                onChange={() => { setProvider('stripe'); setSavedPaymentMethodId(null); }}
              />
              <span className="font-medium">New card via Stripe</span>
              <div className="text-ink-400 text-sm">
                {savedCards.length > 0 ? (
                  <>Enter a card you haven't saved yet.</>
                ) : (
                  <>Requires Stripe keys configured server-side.</>
                )}
              </div>
            </label>
            {savedCards.length === 0 && (
              <p className="text-xs text-ink-400">
                Tip: <Link href="/account/payment-methods" className="underline">save a card</Link> for faster checkout next time.
              </p>
            )}
          </div>
        </Card>
      </div>

      <aside className="ons-card h-fit space-y-3 sticky top-24">
        <CardTitle>Order summary</CardTitle>
        <div className="space-y-2 text-sm">
          {cart.items.map((i) => (
            <div key={i.id} className="flex justify-between">
              <span className="text-ink-300">{i.productTitle} × {i.qty}</span>
              <Money amountMinor={i.lineSubtotalMinor} currency={cart.currency} />
            </div>
          ))}
        </div>
        <div className="h-px bg-ink-800" />
        <div className="flex justify-between text-ink-300"><span>Subtotal</span><Money amountMinor={cart.subtotalMinor} currency={cart.currency} /></div>
        <div className="flex justify-between text-ink-300">
          <span>Shipping{chosen ? ` · ${chosen.serviceDisplayName}` : ''}</span>
          <Money amountMinor={shippingMinor} currency={cart.currency} />
        </div>
        <div className="flex justify-between text-ink-300"><span>Tax (est.)</span><Money amountMinor={tax} currency={cart.currency} /></div>

        <div className="border-t border-ink-800 pt-3 space-y-2">
          <div className="text-xs text-ink-400 uppercase tracking-wider">Discounts</div>
          {appliedCodes.length > 0 && (
            <div className="space-y-1">
              {appliedCodes.map((c) => (
                <div key={c} className="flex items-center justify-between text-sm">
                  <span className="text-success">✓ {c}</span>
                  <button
                    onClick={() => setAppliedCodes((cs) => cs.filter((x) => x !== c))}
                    className="text-xs text-ink-400 hover:text-danger"
                  >
                    remove
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
              placeholder="Promo code"
              className="ons-input flex-1 text-sm"
            />
            <button
              type="button"
              onClick={() => {
                const c = promoCode.trim();
                if (c && !appliedCodes.includes(c)) setAppliedCodes((cs) => [...cs, c].slice(0, 2));
                setPromoCode('');
              }}
              className="ons-btn-ghost text-sm"
            >
              Apply
            </button>
          </div>
          <p className="text-[10px] text-ink-500">Final discount applied at order placement (max 1 seller + 1 platform code).</p>
        </div>

        {walletBalance > 0 && (
          <div className="border-t border-ink-800 pt-3 space-y-2">
            <div className="text-xs text-ink-400 uppercase tracking-wider">Wallet</div>
            <div className="text-sm text-ink-300">
              Balance: <Money amountMinor={walletBalance} currency={cart.currency} />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={Math.min(walletBalance, total)}
                step="0.01"
                value={(walletApply / 100).toFixed(2)}
                onChange={(e) => {
                  const v = Math.max(0, Math.min(walletBalance, Math.round(Number(e.target.value) * 100) || 0));
                  setWalletApply(v);
                }}
                className="ons-input text-sm flex-1"
              />
              <button
                type="button"
                onClick={() => setWalletApply(Math.min(walletBalance, total))}
                className="ons-btn-ghost text-xs"
              >
                Use max
              </button>
            </div>
          </div>
        )}

        <div className="flex justify-between text-lg pt-2"><span className="font-semibold">Total</span><Money amountMinor={Math.max(0, total - walletApply)} currency={cart.currency} emphasized /></div>
        {err && <p className="text-danger text-sm">{err}</p>}
        <Button fullWidth loading={busy} onClick={placeOrder}>Place order</Button>
      </aside>
    </div>
  );
}
