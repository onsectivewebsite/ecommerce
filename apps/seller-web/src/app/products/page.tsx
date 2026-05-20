'use client';

import * as React from 'react';
import Link from 'next/link';
import { Badge, Card, CardDescription, CardTitle, Money } from '@onsective/ui';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function ProductsPage() {
  const { user, loading } = useAuth();
  const [list, setList] = React.useState<any>(null);

  React.useEffect(() => {
    if (loading || !user) return;
    api.seller.listProducts().then(setList).catch(() => setList({ items: [] }));
  }, [loading, user]);

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-3xl tracking-tight">Products</h1>
        <Link href="/products/new" className="ons-btn-primary">+ New product</Link>
      </div>
      {!list ? (
        <p className="text-ink-400">Loading…</p>
      ) : list.items.length === 0 ? (
        <Card>
          <CardTitle>No products yet</CardTitle>
          <CardDescription>Add your first listing to start selling on Onsective.</CardDescription>
          <Link href="/products/new" className="ons-btn-primary inline-flex mt-4">Add a product</Link>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.items.map((p: any) => (
            <div key={p.id} className="ons-card p-0 overflow-hidden">
              {p.media[0]?.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.media[0].url} alt={p.title} className="aspect-video w-full object-cover" />
              ) : (
                <div className="aspect-video bg-ink-800" />
              )}
              <div className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium line-clamp-1">{p.title}</span>
                  <Badge tone={p.status === 'ACTIVE' ? 'success' : 'neutral'}>{p.status}</Badge>
                </div>
                <div className="mt-2 text-sm text-ink-400">/{p.slug}</div>
                <div className="mt-2"><Money amountMinor={p.basePriceMinor} currency={p.currency} /></div>
                <div className="mt-3 flex gap-3 text-sm">
                  <Link href={`/products/${p.id}/digital`} className="text-accent-300 hover:underline">Digital config</Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
