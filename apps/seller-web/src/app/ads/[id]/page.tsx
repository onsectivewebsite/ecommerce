'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { Badge, Button, Card, CardDescription, CardTitle, Input, Money } from '@onsective/ui';
import type { AdCampaignDto, CurrencyCode } from '@onsective/shared-types';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function CampaignDetail() {
  const params = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const [c, setC] = React.useState<AdCampaignDto | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [products, setProducts] = React.useState<any[]>([]);

  const reload = React.useCallback(() => {
    if (!user) return;
    api.ads.getCampaign(params.id).then(setC).catch(() => undefined);
    api.seller.listProducts(1, 100).then((r) => setProducts(r.items as any[])).catch(() => undefined);
  }, [user, params.id]);

  React.useEffect(() => { if (!loading && user) reload(); }, [loading, user, reload]);

  async function addPlacement(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    try {
      await api.ads.addPlacement(params.id, {
        type: String(fd.get('type')) as any,
        productId: String(fd.get('productId') ?? '') || undefined,
        searchKeyword: String(fd.get('keyword') ?? '') || undefined,
        weight: Number(fd.get('weight') ?? 1),
      });
      (e.currentTarget as HTMLFormElement).reset();
      reload();
    } finally { setBusy(false); }
  }

  async function deletePlacement(id: string) {
    setBusy(true);
    try { await api.ads.deletePlacement(id); reload(); }
    finally { setBusy(false); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!c) return <div className="container py-16 text-ink-400">Loading campaign…</div>;

  return (
    <div className="container py-10 max-w-4xl space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight">{c.name}</h1>
          <div className="text-sm text-ink-400 mt-1">
            <Badge tone={c.status === 'ACTIVE' ? 'success' : 'neutral'}>{c.status}</Badge>{' '}
            <Badge tone="accent">{c.pricingModel}</Badge>{' · '}
            Bid <Money amountMinor={c.bidMinor} currency={c.currency as CurrencyCode} />{' · '}
            Spent <Money amountMinor={c.spentMinor} currency={c.currency as CurrencyCode} />
          </div>
        </div>
      </header>

      <Card>
        <CardTitle>Placements</CardTitle>
        <CardDescription>Where this campaign runs. At least one placement is required to start serving.</CardDescription>
        <div className="mt-4 space-y-2">
          {(c.placements ?? []).length === 0 ? (
            <p className="text-ink-400 text-sm">No placements yet.</p>
          ) : (c.placements ?? []).map((p) => (
            <div key={p.id} className="flex items-center justify-between border-b border-ink-800 last:border-0 py-2">
              <div>
                <Badge tone="accent">{p.type}</Badge>{' '}
                <span className="text-ink-200">
                  {p.product ? p.product.title : p.searchKeyword ? `keyword "${p.searchKeyword}"` : p.categorySlug ? `category ${p.categorySlug}` : '—'}
                </span>
                <div className="text-xs text-ink-400">weight {p.weight}</div>
              </div>
              <Button size="sm" variant="danger" loading={busy} onClick={() => deletePlacement(p.id)}>Remove</Button>
            </div>
          ))}
        </div>

        <form onSubmit={addPlacement} className="mt-6 grid grid-cols-12 gap-3 items-end">
          <div className="col-span-3">
            <label className="text-sm font-medium text-ink-200">Type</label>
            <select name="type" className="ons-input mt-1.5">
              <option value="SPONSORED_PRODUCT" className="bg-ink-900">Sponsored product</option>
              <option value="SEARCH_SPONSOR"    className="bg-ink-900">Search sponsor</option>
              <option value="BANNER_SLOT"       className="bg-ink-900">Banner slot</option>
            </select>
          </div>
          <div className="col-span-5">
            <label className="text-sm font-medium text-ink-200">Product (for sponsored)</label>
            <select name="productId" className="ons-input mt-1.5">
              <option value="" className="bg-ink-900">— none —</option>
              {products.map((p) => <option key={p.id} value={p.id} className="bg-ink-900">{p.title}</option>)}
            </select>
          </div>
          <Input className="col-span-2" label="Keyword (search)" name="keyword" />
          <Input className="col-span-1" label="Weight" name="weight" type="number" defaultValue="1" />
          <div className="col-span-1"><Button type="submit" loading={busy}>+ Add</Button></div>
        </form>
      </Card>
    </div>
  );
}
