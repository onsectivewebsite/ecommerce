'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type { ReviewRow } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function SellerReviewsPage() {
  const { user, loading } = useAuth();
  const [rows, setRows] = React.useState<(ReviewRow & { product?: { title: string; slug: string } })[] | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    api.reviews.listForSeller().then(setRows as any).catch(() => setRows([]));
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function reply(id: string) {
    const text = prompt('Your reply (public, one-time only):');
    if (!text) return;
    setBusyId(id);
    try { await api.reviews.reply(id, { reply: text }); load(); }
    finally { setBusyId(null); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!rows) return <div className="container py-16 text-ink-400">Loading reviews…</div>;

  return (
    <div className="container py-10">
      <h1 className="font-display text-3xl tracking-tight mb-6">Reviews</h1>
      {rows.length === 0 ? (
        <p className="text-ink-400">No reviews yet.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="ons-card">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-ink-400">{r.product?.title ?? r.productId}</div>
                  <div className="font-medium">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)} {r.title ? `· ${r.title}` : ''}</div>
                </div>
                <Badge tone={r.status === 'VISIBLE' ? 'success' : 'danger'}>{r.status}</Badge>
              </div>
              <p className="mt-2 text-ink-200 whitespace-pre-wrap">{r.body}</p>
              {r.sellerReply ? (
                <div className="mt-3 border-l-2 border-accent-500/40 pl-3 text-sm text-ink-300">
                  <div className="text-xs text-ink-400">Your reply · {r.sellerRepliedAt && new Date(r.sellerRepliedAt).toLocaleString()}</div>
                  {r.sellerReply}
                </div>
              ) : r.status === 'VISIBLE' ? (
                <button disabled={busyId === r.id} onClick={() => reply(r.id)} className="ons-btn-ghost text-sm mt-3">
                  Reply
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
