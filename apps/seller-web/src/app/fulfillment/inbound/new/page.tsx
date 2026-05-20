'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { PublicWarehouseRow } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

interface VariantPick {
  variantId: string;
  expectedQty: number;
  sku: string;
  productTitle: string;
  variantName: string;
}

export default function NewInboundPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [warehouses, setWarehouses] = React.useState<PublicWarehouseRow[]>([]);
  const [warehouseId, setWarehouseId] = React.useState('');
  const [note, setNote] = React.useState('');

  // Variant picker: search by SKU.
  const [skuQuery, setSkuQuery] = React.useState('');
  const [searchResults, setSearchResults] = React.useState<Array<{ id: string; sku: string; name: string; product: { title: string } }>>([]);
  const [searching, setSearching] = React.useState(false);
  const [picked, setPicked] = React.useState<VariantPick[]>([]);

  const [submitting, setSubmitting] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (loading || !user) return;
    api.warehouses.publicList().then((w) => {
      setWarehouses(w);
      if (w[0]) setWarehouseId(w[0].id);
    });
  }, [loading, user]);

  async function searchSku() {
    if (!skuQuery.trim()) return;
    setSearching(true);
    try {
      const list = await api.seller.searchVariantsBySku?.(skuQuery.trim()) ?? [];
      setSearchResults(list);
    } catch {
      setSearchResults([]);
    } finally { setSearching(false); }
  }

  function add(v: { id: string; sku: string; name: string; product: { title: string } }) {
    if (picked.find((p) => p.variantId === v.id)) return;
    setPicked((p) => [...p, { variantId: v.id, expectedQty: 1, sku: v.sku, productTitle: v.product.title, variantName: v.name }]);
  }

  function setQty(id: string, qty: number) {
    setPicked((p) => p.map((x) => (x.variantId === id ? { ...x, expectedQty: Math.max(1, qty) } : x)));
  }

  function remove(id: string) {
    setPicked((p) => p.filter((x) => x.variantId !== id));
  }

  async function submit() {
    if (!warehouseId || picked.length === 0) { setErr('Pick a warehouse and at least one item.'); return; }
    setSubmitting(true); setErr(null);
    try {
      await api.inbound.create({
        warehouseId,
        note: note || undefined,
        items: picked.map((p) => ({ variantId: p.variantId, expectedQty: p.expectedQty })),
      });
      router.push('/fulfillment/inbound');
    } catch (e) {
      setErr((e as Error).message);
      setSubmitting(false);
    }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-10 max-w-3xl">
      <Link href="/fulfillment/inbound" className="text-sm text-accent-300 hover:underline">← back</Link>
      <h1 className="font-display text-3xl tracking-tight mt-3 mb-6">New inbound shipment</h1>

      <div className="ons-card space-y-3 mb-6">
        <div>
          <label className="block text-sm text-ink-300 mb-1">Destination warehouse</label>
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="ons-input w-full">
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.code} — {w.displayName} ({w.country})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-ink-300 mb-1">Internal note (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} className="ons-input w-full" />
        </div>
      </div>

      <div className="ons-card space-y-3 mb-6">
        <h2 className="font-medium">Add SKUs</h2>
        <div className="flex gap-2">
          <input
            value={skuQuery}
            onChange={(e) => setSkuQuery(e.target.value)}
            placeholder="SKU search"
            className="ons-input flex-1"
            onKeyDown={(e) => { if (e.key === 'Enter') searchSku(); }}
          />
          <button disabled={searching || !skuQuery} onClick={searchSku} className="ons-btn-ghost">Find</button>
        </div>
        {searchResults.length > 0 && (
          <div className="space-y-1">
            {searchResults.map((v) => (
              <div key={v.id} className="flex items-center justify-between text-sm border-b border-ink-800 last:border-0 py-1">
                <div>
                  <code className="text-xs">{v.sku}</code> · {v.product.title} — {v.name}
                </div>
                <button onClick={() => add(v)} className="ons-btn-ghost text-xs">+ add</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="ons-card mb-6">
        <h2 className="font-medium mb-2">Shipment lines</h2>
        {picked.length === 0 ? (
          <p className="text-ink-400 text-sm">Search above to add SKUs.</p>
        ) : (
          <div className="space-y-2">
            {picked.map((p) => (
              <div key={p.variantId} className="flex items-center justify-between gap-2">
                <div className="flex-1 text-sm">
                  <code className="text-xs">{p.sku}</code> · {p.productTitle} — {p.variantName}
                </div>
                <input
                  type="number"
                  min={1}
                  value={p.expectedQty}
                  onChange={(e) => setQty(p.variantId, Number(e.target.value) || 1)}
                  className="ons-input w-24 text-right"
                />
                <button onClick={() => remove(p.variantId)} className="ons-btn-ghost text-xs text-danger">×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {err && <div className="text-danger text-sm mb-3">{err}</div>}
      <button disabled={submitting || !warehouseId || picked.length === 0} onClick={submit} className="ons-btn-primary">
        {submitting ? 'Creating…' : 'Create draft inbound'}
      </button>
    </div>
  );
}
