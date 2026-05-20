'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { OrderDto } from '@onsective/shared-types';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const REASONS = [
  'NOT_AS_DESCRIBED',
  'DAMAGED',
  'WRONG_ITEM',
  'NO_LONGER_NEEDED',
  'ARRIVED_LATE',
  'OTHER',
] as const;

export default function NewReturnPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const orderId = sp.get('orderId') ?? '';
  const { user, loading: authLoading } = useAuth();

  const [order, setOrder] = React.useState<OrderDto | null>(null);
  const [reason, setReason] = React.useState<(typeof REASONS)[number]>('NOT_AS_DESCRIBED');
  const [note, setNote] = React.useState('');
  const [qty, setQty] = React.useState<Record<string, number>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!user || !orderId) return;
    api.orders.get(orderId).then((o) => {
      setOrder(o);
      const initial: Record<string, number> = {};
      for (const it of o.items) initial[it.id] = 0;
      setQty(initial);
    }).catch((e) => setErr(e?.message ?? 'Failed to load order'));
  }, [user, orderId]);

  if (authLoading) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!user) return <div className="container py-16"><Link href={`/login?next=/account/returns/new?orderId=${orderId}`} className="ons-btn-primary">Sign in</Link></div>;
  if (!orderId) return <div className="container py-16 text-danger">Missing orderId in URL</div>;
  if (err) return <div className="container py-16 text-danger">{err}</div>;
  if (!order) return <div className="container py-16 text-ink-400">Loading order…</div>;

  const items = Object.entries(qty).filter(([, q]) => q > 0).map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
  const canSubmit = items.length > 0 && !submitting;

  async function submit() {
    setSubmitting(true);
    setErr(null);
    try {
      await api.returns.request({ orderId, reason, buyerNote: note || undefined, items });
      router.push('/account/returns');
    } catch (e) {
      setErr((e as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div className="container py-10 max-w-2xl">
      <h1 className="font-display text-3xl tracking-tight mb-6">Start a return</h1>
      <div className="ons-card space-y-4">
        <div>
          <div className="text-xs text-ink-400">Order #{order.id.slice(-8)}</div>
          <div className="font-medium">{order.sellerName}</div>
        </div>

        <div>
          <label className="block text-sm text-ink-300 mb-1">Reason</label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as (typeof REASONS)[number])}
            className="ons-input w-full"
          >
            {REASONS.map((r) => (
              <option key={r} value={r}>{r.replace(/_/g, ' ').toLowerCase()}</option>
            ))}
          </select>
        </div>

        <div>
          <div className="text-sm text-ink-300 mb-2">Items to return</div>
          <div className="space-y-2">
            {order.items.map((it) => (
              <div key={it.id} className="flex items-center justify-between border border-ink-800 rounded-md px-3 py-2">
                <div>
                  <div className="font-medium">{it.productTitleSnapshot}</div>
                  <div className="text-xs text-ink-400">{it.variantNameSnapshot} · purchased qty {it.qty}</div>
                </div>
                <input
                  type="number"
                  min={0}
                  max={it.qty}
                  value={qty[it.id] ?? 0}
                  onChange={(e) => setQty((q) => ({ ...q, [it.id]: Math.min(it.qty, Math.max(0, Number(e.target.value) || 0)) }))}
                  className="ons-input w-20 text-right"
                />
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm text-ink-300 mb-1">Note (optional)</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="ons-input w-full" />
        </div>

        {err && <div className="text-danger text-sm">{err}</div>}
        <div className="flex gap-3">
          <button disabled={!canSubmit} onClick={submit} className="ons-btn-primary">
            {submitting ? 'Submitting…' : 'Submit return request'}
          </button>
          <Link href={`/orders/${orderId}`} className="ons-btn-ghost">Cancel</Link>
        </div>
      </div>
    </div>
  );
}
