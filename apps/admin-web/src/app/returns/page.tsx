'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type { ReturnRow } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

function tone(status: string): 'success' | 'danger' | 'accent' | 'neutral' {
  switch (status) {
    case 'REFUNDED': return 'success';
    case 'REJECTED': return 'danger';
    case 'APPROVED':
    case 'SHIPPED':
    case 'RECEIVED': return 'accent';
    default: return 'neutral';
  }
}

const STATUSES = ['REQUESTED', 'APPROVED', 'SHIPPED', 'RECEIVED', 'REFUNDED', 'REJECTED', 'CANCELLED'];

export default function AdminReturnsPage() {
  const { user, loading } = useAuth();
  const [status, setStatus] = React.useState<string>('');
  const [rows, setRows] = React.useState<ReturnRow[] | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    api.returns.adminList(status || undefined).then(setRows).catch((e) => setErr(e?.message ?? 'Failed'));
  }, [status]);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function force(id: string) {
    if (!confirm('Force-refund this return at the buyer\'s requested amount?')) return;
    setBusyId(id);
    try { await api.returns.adminForceRefund(id); load(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusyId(null); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (err) return <div className="container py-16 text-danger">{err}</div>;

  return (
    <div className="container py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-3xl tracking-tight">Returns queue</h1>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="ons-input">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {!rows ? <div className="text-ink-400">Loading…</div> :
       rows.length === 0 ? <p className="text-ink-400">No returns.</p> :
       <div className="space-y-3">
         {rows.map((r) => (
           <div key={r.id} className="ons-card flex items-center gap-4">
             <div className="flex-1">
               <div className="text-xs text-ink-400">#{r.id.slice(-8)} · order #{r.orderId.slice(-8)}</div>
               <div className="font-medium">{r.reason.replace(/_/g, ' ').toLowerCase()}</div>
               <div className="text-xs text-ink-400">{new Date(r.createdAt).toLocaleString()}</div>
               {r.buyerNote && <div className="text-xs text-ink-300 mt-1">Buyer: {r.buyerNote}</div>}
               {r.sellerNote && <div className="text-xs text-ink-300">Seller: {r.sellerNote}</div>}
             </div>
             <Badge tone={tone(r.status)}>{r.status.replace(/_/g, ' ')}</Badge>
             {r.status !== 'REFUNDED' && r.status !== 'CANCELLED' && (
               <button disabled={busyId === r.id} onClick={() => force(r.id)} className="ons-btn-ghost text-sm">
                 Force refund
               </button>
             )}
           </div>
         ))}
       </div>}
    </div>
  );
}
