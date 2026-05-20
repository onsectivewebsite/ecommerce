'use client';

import * as React from 'react';
import type { PickListRow, PublicWarehouseRow } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function PickListPage() {
  const { user, loading } = useAuth();
  const [warehouses, setWarehouses] = React.useState<PublicWarehouseRow[]>([]);
  const [warehouseId, setWarehouseId] = React.useState('');
  const [rows, setRows] = React.useState<PickListRow[] | null>(null);
  const [sortBy, setSortBy] = React.useState<'oldest' | 'sku'>('oldest');

  React.useEffect(() => {
    if (loading || !user) return;
    api.warehouses.publicList().then((w) => {
      setWarehouses(w);
      if (w[0]) setWarehouseId(w[0].id);
    });
  }, [loading, user]);

  const load = React.useCallback(() => {
    if (!warehouseId) return;
    api.pickList.list(warehouseId).then(setRows).catch(() => setRows([]));
  }, [warehouseId]);

  React.useEffect(() => { load(); }, [load]);

  const sorted = React.useMemo(() => {
    if (!rows) return null;
    const copy = [...rows];
    if (sortBy === 'sku') copy.sort((a, b) => a.sku.localeCompare(b.sku));
    return copy;
  }, [rows, sortBy]);

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-10 max-w-5xl">
      <div className="flex items-center justify-between mb-6 gap-4">
        <h1 className="font-display text-3xl tracking-tight">Pick list</h1>
        <div className="flex gap-2">
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} className="ons-input">
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.code} — {w.displayName}</option>
            ))}
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as 'oldest' | 'sku')} className="ons-input">
            <option value="oldest">Oldest order first</option>
            <option value="sku">Batch by SKU</option>
          </select>
          <button onClick={load} className="ons-btn-ghost">Refresh</button>
        </div>
      </div>
      {!sorted ? (
        <div className="text-ink-400">Loading…</div>
      ) : sorted.length === 0 ? (
        <p className="text-ink-400">Nothing to pick right now.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-ink-400 text-xs uppercase">
            <tr>
              <th className="text-left py-2">Bin</th>
              <th className="text-left py-2">SKU</th>
              <th className="text-left py-2">Product</th>
              <th className="text-right py-2">Qty</th>
              <th className="text-left py-2">Order</th>
              <th className="text-left py-2">Ship to</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.orderItemId} className="border-t border-ink-800">
                <td className="py-2 font-mono text-xs">{r.binLocation ?? '—'}</td>
                <td className="py-2 font-mono text-xs">{r.sku}</td>
                <td className="py-2">{r.productTitle} <span className="text-ink-400">— {r.variantName}</span></td>
                <td className="py-2 text-right font-mono">{r.qty}</td>
                <td className="py-2 text-xs font-mono">#{r.orderShort}</td>
                <td className="py-2 text-xs text-ink-300">{r.shipTo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
