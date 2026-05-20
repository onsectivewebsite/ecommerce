'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Money } from '@onsective/ui';
import type { ProductDetailDto } from '@onsective/shared-types';
import { useCart } from '@/lib/cart-context';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { AgeGate } from './AgeGate';
import { SlaPromise } from './SlaPromise';

export function ProductBuyBox({ product }: { product: ProductDetailDto }) {
  const router = useRouter();
  const { user } = useAuth();
  const { addItem } = useCart();
  const [variantId, setVariantId] = React.useState(product.variants[0]?.id ?? '');
  const [qty, setQty] = React.useState(1);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [ageOk, setAgeOk] = React.useState(false);
  const [wishlisted, setWishlisted] = React.useState(false);
  const [wishBusy, setWishBusy] = React.useState(false);

  React.useEffect(() => {
    if (!user) return;
    api.wishlists.mine()
      .then((w) => setWishlisted(w.items.some((it) => it.productId === product.id)))
      .catch(() => undefined);
  }, [user, product.id]);

  async function toggleWishlist() {
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(`/p/${product.slug}`)}`);
      return;
    }
    setWishBusy(true);
    try {
      if (wishlisted) await api.wishlists.remove(product.id);
      else await api.wishlists.add(product.id);
      setWishlisted(!wishlisted);
    } finally { setWishBusy(false); }
  }

  const requiresAge = !!product.compliance?.requiresAgeCheck;
  const minAge = product.compliance?.minBuyerAge ?? 18;
  const isDigital = !!product.compliance?.isDigital;
  const restricted = (product.compliance?.blockedCountries ?? []).length > 0
    || (product.compliance?.allowedCountries ?? []).length > 0;

  const variant = product.variants.find((v) => v.id === variantId) ?? product.variants[0];

  async function handleAdd(buyNow: boolean) {
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(`/p/${product.slug}`)}`);
      return;
    }
    if (!variant) return;
    if (requiresAge && !ageOk) {
      setErr(`Please verify you are at least ${minAge} years old.`);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await addItem(variant.id, qty);
      if (buyNow) router.push('/cart');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to add');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ons-card flex flex-col gap-5">
      {requiresAge && !ageOk && (
        <AgeGate
          productId={product.id}
          productTitle={product.title}
          minAge={minAge}
          onPass={() => setAgeOk(true)}
        />
      )}
      <div>
        <div className="text-xs uppercase tracking-wider text-gold-400">{product.sellerName}</div>
        <h1 className="font-display text-3xl tracking-tight mt-1">{product.title}</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          {isDigital && <Badge tone="accent">Digital delivery</Badge>}
          {requiresAge && <Badge tone="warning">{minAge}+ only</Badge>}
          {restricted && <Badge tone="neutral">Some regions restricted</Badge>}
        </div>
      </div>
      <div className="flex items-baseline gap-3">
        <Money amountMinor={variant?.priceMinor ?? product.basePriceMinor} currency={product.currency} emphasized className="text-3xl" />
        <span className="text-ink-400 text-sm">in stock: {variant?.inventoryQty ?? 0}</span>
      </div>
      <SlaPromise productId={product.id} />

      {product.variants.length > 1 && (
        <div>
          <div className="text-sm font-medium mb-2">Variant</div>
          <div className="flex flex-wrap gap-2">
            {product.variants.map((v) => (
              <button
                key={v.id}
                onClick={() => setVariantId(v.id)}
                className={[
                  'ons-btn px-3 py-2 text-sm border',
                  v.id === variantId ? 'border-accent-500 bg-accent-500/10 text-ink-50' : 'border-ink-700 bg-ink-900 hover:bg-ink-800',
                ].join(' ')}
              >
                {v.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <label className="text-sm">Qty</label>
        <input
          type="number"
          min={1}
          max={variant?.inventoryQty ?? 1}
          value={qty}
          onChange={(e) => setQty(Math.max(1, Number(e.target.value || 1)))}
          className="ons-input w-24"
        />
      </div>

      {err && <div className="text-danger text-sm">{err}</div>}

      <div className="flex gap-3">
        <Button onClick={() => handleAdd(false)} loading={busy} variant="secondary">
          Add to cart
        </Button>
        <Button onClick={() => handleAdd(true)} loading={busy}>
          Buy now
        </Button>
        <button
          type="button"
          onClick={toggleWishlist}
          disabled={wishBusy}
          title={wishlisted ? 'Remove from wishlist' : 'Save to wishlist'}
          className={[
            'ons-btn-ghost px-3 text-lg',
            wishlisted ? 'text-accent-300' : 'text-ink-300 hover:text-accent-300',
          ].join(' ')}
        >
          {wishlisted ? '♥' : '♡'}
        </button>
      </div>
    </div>
  );
}
