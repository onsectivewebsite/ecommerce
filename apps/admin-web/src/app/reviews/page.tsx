'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type { ReviewRow } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const STATUSES = ['VISIBLE', 'HIDDEN_BY_ADMIN', 'DELETED_BY_BUYER'];

export default function AdminReviewsPage() {
  const { user, loading } = useAuth();
  const [status, setStatus] = React.useState<string>('');
  const [rows, setRows] = React.useState<ReviewRow[] | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    api.reviews.adminList(status || undefined).then(setRows).catch(() => setRows([]));
  }, [status]);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function hide(id: string) {
    const reason = prompt('Hide reason:');
    if (!reason) return;
    setBusyId(id);
    try { await api.reviews.adminHide(id, { reason }); load(); }
    finally { setBusyId(null); }
  }

  async function unhide(id: string) {
    setBusyId(id);
    try { await api.reviews.adminUnhide(id); load(); }
    finally { setBusyId(null); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-3xl tracking-tight">Reviews moderation</h1>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="ons-input">
          <option value="">All</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {!rows ? <div className="text-ink-400">Loading…</div> :
       rows.length === 0 ? <p className="text-ink-400">Nothing to moderate.</p> :
       <div className="space-y-3">
         {rows.map((r) => (
           <div key={r.id} className="ons-card">
             <div className="flex items-center justify-between">
               <div className="text-xs text-ink-400">#{r.id.slice(-8)} · product #{r.productId.slice(-8)}</div>
               <Badge tone={r.status === 'VISIBLE' ? 'success' : 'danger'}>{r.status}</Badge>
             </div>
             <div className="mt-2 font-medium">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)} {r.title ? `· ${r.title}` : ''}</div>
             <p className="mt-1 text-ink-200 whitespace-pre-wrap">{r.body}</p>
             {r.sellerReply && (
               <div className="mt-2 border-l-2 border-accent-500/40 pl-3 text-sm text-ink-300">
                 <div className="text-xs text-ink-400">Seller reply</div>{r.sellerReply}
               </div>
             )}
             <div className="mt-3 flex gap-2">
               {r.status === 'VISIBLE' ? (
                 <button disabled={busyId === r.id} onClick={() => hide(r.id)} className="ons-btn-ghost text-sm text-danger">Hide</button>
               ) : r.status === 'HIDDEN_BY_ADMIN' ? (
                 <button disabled={busyId === r.id} onClick={() => unhide(r.id)} className="ons-btn-ghost text-sm">Unhide</button>
               ) : null}
             </div>
           </div>
         ))}
       </div>}
    </div>
  );
}
