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

export default function SellerReturnsPage() {
  const { user, loading } = useAuth();
  const [rows, setRows] = React.useState<ReturnRow[] | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    api.returns.listForSeller().then(setRows).catch((e) => setErr(e?.message ?? 'Failed to load'));
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function approve(id: string) {
    setBusyId(id);
    try { await api.returns.approve(id); load(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusyId(null); }
  }

  async function reject(id: string) {
    const note = prompt('Reason for rejection (visible to buyer):');
    if (!note) return;
    setBusyId(id);
    try { await api.returns.reject(id, { sellerNote: note }); load(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusyId(null); }
  }

  async function markReceived(id: string) {
    if (!confirm('Confirm physical receipt? This issues the refund immediately.')) return;
    setBusyId(id);
    try { await api.returns.markReceived(id); load(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusyId(null); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (err) return <div className="container py-16 text-danger">{err}</div>;
  if (!rows) return <div className="container py-16 text-ink-400">Loading returns…</div>;

  return (
    <div className="container py-10">
      <h1 className="font-display text-3xl tracking-tight mb-6">Returns</h1>
      {rows.length === 0 ? (
        <p className="text-ink-400">No returns right now.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="ons-card flex items-center gap-4">
              <div className="flex-1">
                <div className="text-xs text-ink-400">#{r.id.slice(-8)} · order #{r.orderId.slice(-8)}</div>
                <div className="font-medium">Reason: {r.reason.replace(/_/g, ' ').toLowerCase()}</div>
                <div className="text-xs text-ink-400">{new Date(r.createdAt).toLocaleString()}</div>
                {r.buyerNote && <div className="text-xs text-ink-300 mt-1">Buyer: {r.buyerNote}</div>}
              </div>
              <Badge tone={tone(r.status)}>{r.status.replace(/_/g, ' ')}</Badge>
              <div className="flex gap-2">
                {r.status === 'REQUESTED' && (
                  <>
                    <button disabled={busyId === r.id} onClick={() => approve(r.id)} className="ons-btn-primary text-sm">
                      Approve
                    </button>
                    <button disabled={busyId === r.id} onClick={() => reject(r.id)} className="ons-btn-ghost text-sm text-danger">
                      Reject
                    </button>
                  </>
                )}
                {(r.status === 'APPROVED' || r.status === 'SHIPPED') && (
                  <button disabled={busyId === r.id} onClick={() => markReceived(r.id)} className="ons-btn-primary text-sm">
                    Mark received & refund
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
