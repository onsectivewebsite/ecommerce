'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type {
  ListingCondition,
  ListingFulfillmentMode,
  SellerListingRow,
} from '@onsective/api-client';
import type { ProductSummaryDto } from '@onsective/shared-types';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const CONDITIONS: ListingCondition[] = [
  'NEW_GENUINE', 'REFURB_GRADE_A', 'REFURB_GRADE_B', 'REFURB_GRADE_C', 'OPEN_BOX',
];

function moneyDollars(minor: number, currency: string) {
  return `${(minor / 100).toLocaleString(undefined, { style: 'currency', currency })}`;
}

function statusTone(s: string): 'success' | 'warning' | 'danger' {
  if (s === 'ACTIVE') return 'success';
  if (s === 'OUT_OF_STOCK') return 'warning';
  return 'danger';
}

export default function SellerListingsPage() {
  const { user, loading } = useAuth();
  const [rows, setRows] = React.useState<SellerListingRow[] | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Add-new-listing form state
  const [query, setQuery] = React.useState('');
  const [searching, setSearching] = React.useState(false);
  const [searchResults, setSearchResults] = React.useState<ProductSummaryDto[] | null>(null);
  const [picked, setPicked] = React.useState<ProductSummaryDto | null>(null);
  const [sku, setSku] = React.useState('');
  const [priceDollars, setPriceDollars] = React.useState('');
  const [condition, setCondition] = React.useState<ListingCondition>('NEW_GENUINE');
  const [fulfillment, setFulfillment] = React.useState<ListingFulfillmentMode>('SELLER');
  const [submitting, setSubmitting] = React.useState(false);

  const load = React.useCallback(() => {
    api.listings.list().then(setRows).catch(() => setRows([]));
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function doSearch(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim().length < 2) return;
    setSearching(true);
    setPicked(null);
    try {
      const r = await api.search.query({ query: query.trim(), pageSize: 10 });
      setSearchResults(r.items);
    } finally {
      setSearching(false);
    }
  }

  async function submitListing(e: React.FormEvent) {
    e.preventDefault();
    if (!picked) return;
    const minor = Math.round(Number(priceDollars) * 100);
    if (!Number.isFinite(minor) || minor < 1) {
      setError('Price must be a positive number'); return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.listings.create({
        productId: picked.id,
        sku: sku.trim() || picked.slug,
        condition,
        priceMinor: minor,
        currency: picked.currency as string,
        fulfillmentMode: fulfillment,
      });
      setPicked(null); setSku(''); setPriceDollars(''); setQuery(''); setSearchResults(null);
      load();
    } catch (e) {
      setError((e as Error).message || 'Could not create listing');
    } finally {
      setSubmitting(false);
    }
  }

  async function toggle(l: SellerListingRow) {
    setBusyId(l.id);
    try {
      if (l.status === 'ACTIVE') await api.listings.deactivate(l.id);
      else await api.listings.reactivate(l.id);
      load();
    } finally { setBusyId(null); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-10 grid lg:grid-cols-[1fr_1fr] gap-6">
      <div>
        <h1 className="font-display text-3xl tracking-tight mb-6">My listings</h1>
        {!rows ? <p className="text-ink-400">Loading…</p> :
         rows.length === 0 ? <p className="text-ink-400">You have no listings yet. Use the panel on the right to list on an existing product.</p> :
         <ul className="space-y-3">
           {rows.map((l) => (
             <li key={l.id} className="ons-card flex items-center gap-3">
               {l.productImageUrl ? (
                 // eslint-disable-next-line @next/next/no-img-element
                 <img src={l.productImageUrl} alt={l.productTitle} className="w-14 h-14 rounded-md object-cover shrink-0" />
               ) : (
                 <div className="w-14 h-14 rounded-md bg-ink-800 shrink-0" />
               )}
               <div className="min-w-0 flex-1">
                 <div className="font-medium truncate">{l.productTitle}</div>
                 <div className="text-xs text-ink-500 truncate">
                   /{l.productSlug} · SKU {l.sku} · {l.condition} · {l.fulfillmentMode === 'PLATFORM' ? 'FBO' : 'self-fulfilled'}
                 </div>
                 <div className="text-sm text-ink-200">{moneyDollars(l.priceMinor, l.currency)}</div>
               </div>
               <div className="flex flex-col items-end gap-1 shrink-0">
                 <Badge tone={statusTone(l.status)}>{l.status}</Badge>
                 {l.isBuyBoxWinner && <span className="text-[10px] text-emerald-400 uppercase tracking-wider">Buy Box</span>}
                 <button disabled={busyId === l.id} onClick={() => toggle(l)} className="ons-btn-ghost text-xs">
                   {l.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                 </button>
               </div>
             </li>
           ))}
         </ul>}
      </div>

      <div>
        <h2 className="font-display text-2xl tracking-tight mb-3">Add a listing</h2>
        <p className="text-sm text-ink-400 mb-4">
          Search the Onsective catalog for an existing product and set your price, SKU, and fulfillment method.
          Want a brand-new product?{' '}
          <a href="/products" className="text-accent-300 underline">Create one here</a> — it gets a listing of yours automatically.
        </p>

        <form onSubmit={doSearch} className="ons-card mb-3 flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title…"
            className="ons-input"
          />
          <button type="submit" disabled={searching} className="ons-btn-primary text-sm">
            {searching ? '…' : 'Search'}
          </button>
        </form>

        {searchResults && !picked && (
          <ul className="ons-card space-y-1 max-h-72 overflow-y-auto mb-3">
            {searchResults.length === 0 && <li className="text-ink-400 text-sm">No matches.</li>}
            {searchResults.map((p) => (
              <li
                key={p.id}
                onClick={() => { setPicked(p); setSku(p.slug); setPriceDollars((p.basePriceMinor / 100).toString()); }}
                className="flex items-center gap-2 p-2 rounded hover:bg-ink-800/60 cursor-pointer text-sm"
              >
                {p.media[0]?.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.media[0].url} alt={p.title} className="w-8 h-8 rounded object-cover" />
                ) : <div className="w-8 h-8 bg-ink-800 rounded" />}
                <span className="flex-1 truncate">{p.title}</span>
                <span className="text-ink-500 text-xs">{moneyDollars(p.basePriceMinor, p.currency)}</span>
              </li>
            ))}
          </ul>
        )}

        {picked && (
          <form onSubmit={submitListing} className="ons-card grid gap-3">
            <div className="flex items-center gap-3">
              {picked.media[0]?.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={picked.media[0].url} alt={picked.title} className="w-12 h-12 rounded-md object-cover" />
              ) : <div className="w-12 h-12 bg-ink-800 rounded-md" />}
              <div className="min-w-0">
                <div className="font-medium truncate">{picked.title}</div>
                <div className="text-xs text-ink-500">currency: {picked.currency} — your price must match</div>
              </div>
              <button type="button" onClick={() => setPicked(null)} className="ons-btn-ghost text-xs ml-auto">Change</button>
            </div>
            <div className="grid md:grid-cols-2 gap-2">
              <label className="grid gap-1 text-sm">
                Your SKU
                <input value={sku} onChange={(e) => setSku(e.target.value)} required className="ons-input text-sm" />
              </label>
              <label className="grid gap-1 text-sm">
                Your price ({picked.currency})
                <input value={priceDollars} onChange={(e) => setPriceDollars(e.target.value)} type="number" step="0.01" min={0.01} required className="ons-input text-sm" />
              </label>
              <label className="grid gap-1 text-sm">
                Condition
                <select value={condition} onChange={(e) => setCondition(e.target.value as ListingCondition)} className="ons-input text-sm">
                  {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                Fulfillment
                <select value={fulfillment} onChange={(e) => setFulfillment(e.target.value as ListingFulfillmentMode)} className="ons-input text-sm">
                  <option value="SELLER">I ship it myself</option>
                  <option value="PLATFORM">Onsective Fulfilled</option>
                </select>
              </label>
            </div>
            <button type="submit" disabled={submitting} className="ons-btn-primary self-start text-sm">
              {submitting ? 'Publishing…' : 'Publish listing'}
            </button>
            {error && <p className="text-danger text-sm">{error}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
