'use client';

import * as React from 'react';
import Link from 'next/link';
import { Badge, Money } from '@onsective/ui';
import type { WishlistView } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function WishlistPage() {
  const { user, loading } = useAuth();
  const [list, setList] = React.useState<WishlistView | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    api.wishlists.mine().then(setList).catch(() => setList(null));
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  if (loading) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!user) return <div className="container py-16"><Link href="/login?next=/account/wishlist" className="ons-btn-primary">Sign in</Link></div>;
  if (!list) return <div className="container py-16 text-ink-400">Loading wishlist…</div>;

  async function remove(productId: string) {
    setBusyId(productId);
    try { setList(await api.wishlists.remove(productId)); }
    finally { setBusyId(null); }
  }

  async function share() {
    const r = await api.wishlists.share();
    await navigator.clipboard.writeText(`${location.origin}/shared/wishlist/${r.shareToken}`).catch(() => undefined);
    load();
    alert('Share link copied to clipboard');
  }

  return (
    <div className="container py-10 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-3xl tracking-tight">Wishlist</h1>
        <button onClick={share} className="ons-btn-ghost text-sm">Share list</button>
      </div>
      {list.items.length === 0 ? (
        <p className="text-ink-400">No items yet. Tap the heart on any product to save it.</p>
      ) : (
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
          {list.items.map((it) => {
            const dropped = it.currentPriceMinor < it.snapshotPriceMinor;
            return (
              <div key={it.id} className="ons-card flex flex-col">
                {it.imageUrl && (
                  <img src={it.imageUrl} alt="" className="h-32 w-full object-cover rounded-md mb-2" />
                )}
                <Link href={`/p/${it.slug}`} className="font-medium hover:text-accent-300">{it.title}</Link>
                <div className="mt-1 flex items-center gap-2">
                  <Money amountMinor={it.currentPriceMinor} currency={it.currency} emphasized />
                  {dropped && (
                    <Badge tone="success">
                      ↓ {Math.round(((it.snapshotPriceMinor - it.currentPriceMinor) / it.snapshotPriceMinor) * 100)}%
                    </Badge>
                  )}
                  {!it.snapshotInStock && <Badge tone="danger">Out</Badge>}
                </div>
                <button
                  disabled={busyId === it.productId}
                  onClick={() => remove(it.productId)}
                  className="ons-btn-ghost text-xs mt-2 self-start text-danger"
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
