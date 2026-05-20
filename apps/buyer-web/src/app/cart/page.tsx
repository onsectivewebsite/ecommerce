'use client';

import Link from 'next/link';
import { Button, Money } from '@onsective/ui';
import { useAuth } from '@/lib/auth-context';
import { useCart } from '@/lib/cart-context';

export default function CartPage() {
  const { user, loading: authLoading } = useAuth();
  const { cart, loading, updateItem, removeItem } = useCart();

  if (authLoading) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!user) {
    return (
      <div className="container py-16 text-center">
        <h1 className="font-display text-2xl">Sign in to view your cart</h1>
        <Link href="/login?next=/cart" className="ons-btn-primary mt-6 inline-flex">Sign in</Link>
      </div>
    );
  }
  if (loading && !cart) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!cart || cart.items.length === 0) {
    return (
      <div className="container py-16 text-center">
        <h1 className="font-display text-3xl">Your cart is empty</h1>
        <p className="text-ink-400 mt-2">Hand-picked goods await.</p>
        <Link href="/" className="ons-btn-primary mt-6 inline-flex">Browse the marketplace</Link>
      </div>
    );
  }

  const shipping = 499;
  const tax = Math.round(((cart.subtotalMinor + shipping) * 800) / 10000);
  const total = cart.subtotalMinor + shipping + tax;

  return (
    <div className="container py-10 grid md:grid-cols-[1fr_360px] gap-8">
      <div className="space-y-3">
        {cart.items.map((i) => (
          <div key={i.id} className="ons-card flex items-center gap-4 p-4">
            {i.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={i.imageUrl} alt={i.productTitle} className="h-20 w-20 rounded-lg object-cover bg-ink-800" />
            ) : (
              <div className="h-20 w-20 rounded-lg bg-ink-800" />
            )}
            <div className="flex-1">
              <Link href={`/p/${i.productSlug}`} className="font-medium text-ink-50">{i.productTitle}</Link>
              <div className="text-sm text-ink-400">{i.variantName}</div>
            </div>
            <input
              type="number"
              min={0}
              value={i.qty}
              onChange={(e) => updateItem(i.id, Number(e.target.value || 0))}
              className="ons-input w-20"
            />
            <Money amountMinor={i.lineSubtotalMinor} currency={cart.currency} className="w-24 text-right" />
            <button onClick={() => removeItem(i.id)} className="ons-btn-ghost text-danger">Remove</button>
          </div>
        ))}
      </div>

      <aside className="ons-card h-fit space-y-3 sticky top-24">
        <div className="flex justify-between text-ink-300"><span>Subtotal</span><Money amountMinor={cart.subtotalMinor} currency={cart.currency} /></div>
        <div className="flex justify-between text-ink-300"><span>Shipping</span><Money amountMinor={shipping} currency={cart.currency} /></div>
        <div className="flex justify-between text-ink-300"><span>Tax (est.)</span><Money amountMinor={tax} currency={cart.currency} /></div>
        <div className="h-px bg-ink-800" />
        <div className="flex justify-between"><span className="font-semibold">Total</span><Money amountMinor={total} currency={cart.currency} emphasized /></div>
        <Link href="/checkout" className="block">
          <Button fullWidth>Proceed to checkout</Button>
        </Link>
      </aside>
    </div>
  );
}
