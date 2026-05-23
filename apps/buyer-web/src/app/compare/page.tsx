'use client';

import * as React from 'react';
import Link from 'next/link';
import { Badge, Money } from '@onsective/ui';
import type { CurrencyCode } from '@onsective/shared-types';
import type { ComparisonProduct } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

function attrValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

export default function ComparePage() {
  const { user, loading } = useAuth();
  const [rows, setRows] = React.useState<ComparisonProduct[] | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    api.comparison.list().then(setRows).catch(() => setRows([]));
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function remove(productId: string) {
    setBusy(true);
    try { setRows(await api.comparison.remove(productId)); }
    finally { setBusy(false); }
  }

  async function clearAll() {
    setBusy(true);
    try { await api.comparison.clear(); setRows([]); }
    finally { setBusy(false); }
  }

  if (loading || !user) {
    return <div className="container py-16 text-ink-400">Loading…</div>;
  }

  if (!rows) return <div className="container py-16 text-ink-400">Loading…</div>;

  if (rows.length === 0) {
    return (
      <div className="container py-16">
        <h1 className="font-display text-3xl tracking-tight mb-3">Compare products</h1>
        <p className="text-ink-400">
          Your comparison is empty. Add up to 4 products with the{' '}
          <span className="text-accent-300">Add to compare</span> button on any product page.
        </p>
      </div>
    );
  }

  const attrKeys = [...new Set(rows.flatMap((r) => Object.keys(r.attributes)))].sort();

  const labelCell = 'p-3 text-sm text-ink-400 font-medium align-top whitespace-nowrap';
  const valueCell = 'p-3 text-sm text-ink-100 align-top border-l border-ink-800';

  return (
    <div className="container py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-3xl tracking-tight">Compare products</h1>
        <button onClick={clearAll} disabled={busy} className="ons-btn-ghost text-sm text-danger">Clear all</button>
      </div>

      <div className="overflow-x-auto ons-card p-0">
        <table className="w-full border-collapse">
          <tbody>
            <tr className="border-b border-ink-800">
              <td className={labelCell} />
              {rows.map((r) => (
                <td key={r.productId} className={valueCell}>
                  <div className="flex flex-col gap-2 min-w-[160px]">
                    {r.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.imageUrl} alt={r.title} className="aspect-square w-full object-cover rounded-lg" />
                    ) : (
                      <div className="aspect-square w-full bg-ink-800 rounded-lg" />
                    )}
                    <Link href={`/p/${r.slug}`} className="text-ink-50 font-medium line-clamp-2">{r.title}</Link>
                    <button onClick={() => remove(r.productId)} disabled={busy} className="text-xs text-danger self-start">
                      Remove
                    </button>
                  </div>
                </td>
              ))}
            </tr>
            <tr className="border-b border-ink-800">
              <td className={labelCell}>Price</td>
              {rows.map((r) => (
                <td key={r.productId} className={valueCell}>
                  <Money amountMinor={r.priceMinor} currency={r.currency as CurrencyCode} emphasized />
                </td>
              ))}
            </tr>
            <tr className="border-b border-ink-800">
              <td className={labelCell}>Condition</td>
              {rows.map((r) => (
                <td key={r.productId} className={valueCell}>{r.condition ?? '—'}</td>
              ))}
            </tr>
            <tr className="border-b border-ink-800">
              <td className={labelCell}>Brand</td>
              {rows.map((r) => (
                <td key={r.productId} className={valueCell}>{r.brandName ?? '—'}</td>
              ))}
            </tr>
            <tr className="border-b border-ink-800">
              <td className={labelCell}>Sold by</td>
              {rows.map((r) => (
                <td key={r.productId} className={valueCell}>{r.sellerName}</td>
              ))}
            </tr>
            <tr className="border-b border-ink-800">
              <td className={labelCell}>Category</td>
              {rows.map((r) => (
                <td key={r.productId} className={valueCell}>{r.categoryName}</td>
              ))}
            </tr>
            <tr className="border-b border-ink-800">
              <td className={labelCell}>Rating</td>
              {rows.map((r) => (
                <td key={r.productId} className={valueCell}>
                  {r.ratingCount > 0 ? `★ ${r.ratingAvg} (${r.ratingCount})` : 'No reviews'}
                </td>
              ))}
            </tr>
            <tr className="border-b border-ink-800">
              <td className={labelCell}>Availability</td>
              {rows.map((r) => (
                <td key={r.productId} className={valueCell}>
                  <Badge tone={r.inStock ? 'success' : 'danger'}>{r.inStock ? 'In stock' : 'Out of stock'}</Badge>
                </td>
              ))}
            </tr>
            {attrKeys.map((key) => (
              <tr key={key} className="border-b border-ink-800">
                <td className={labelCell}>{key}</td>
                {rows.map((r) => (
                  <td key={r.productId} className={valueCell}>{attrValue(r.attributes[key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
