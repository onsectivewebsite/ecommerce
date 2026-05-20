'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type { WarrantyClaimRow } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function AdminWarrantyPage() {
  const { user, loading } = useAuth();
  const [queue, setQueue] = React.useState<WarrantyClaimRow[] | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    api.warranty.adminQueue().then(setQueue).catch(() => setQueue([]));
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function approve(id: string) {
    const note = prompt('Approval note (optional)') ?? undefined;
    setBusy(id);
    try { await api.warranty.adminApprove(id, note); load(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  async function resolveRefund(id: string) {
    const note = prompt('Resolution note?') ?? undefined;
    setBusy(id);
    try {
      await api.warranty.adminResolve(id, { status: 'RESOLVED_REFUND', resolutionNote: note });
      load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  async function resolveReject(id: string) {
    const note = prompt('Reason for rejection?');
    if (!note) return;
    setBusy(id);
    try {
      await api.warranty.adminResolve(id, { status: 'REJECTED', resolutionNote: note });
      load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  async function resolveRepair(id: string) {
    setBusy(id);
    try {
      await api.warranty.adminResolve(id, { status: 'RESOLVED_REPAIR' });
      load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!queue) return <div className="container py-16 text-ink-400">Loading warranty queue…</div>;

  return (
    <div className="container py-10">
      <header className="mb-6">
        <h1 className="font-display text-3xl tracking-tight">Warranty claims</h1>
        <p className="text-sm text-ink-400 mt-1">Open and approved claims awaiting resolution.</p>
      </header>

      {err && <div className="text-danger text-sm mb-4">{err}</div>}

      {queue.length === 0 ? (
        <p className="text-ink-400">No active claims.</p>
      ) : (
        <div className="space-y-3">
          {queue.map((c) => (
            <div key={c.id} className="ons-card">
              <div className="flex items-start gap-4">
                <Badge tone={c.status === 'OPEN' ? 'warning' : 'success'}>{c.status}</Badge>
                <div className="flex-1">
                  <p className="text-sm font-medium">{c.symptom}</p>
                  <p className="text-xs text-ink-500 mt-1">Filed {new Date(c.createdAt).toLocaleString()}</p>
                  {c.evidence.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {c.evidence.map((e, idx) => e.kind === 'NOTE' ? (
                        <span key={idx} className="text-xs italic text-ink-300">"{e.note}"</span>
                      ) : (
                        <a key={idx} href={e.url} target="_blank" rel="noreferrer"
                           className="text-xs underline text-gold-400">{e.kind.toLowerCase()}</a>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  {c.status === 'OPEN' && (
                    <button disabled={busy === c.id} onClick={() => approve(c.id)} className="ons-btn-ghost text-xs">Approve</button>
                  )}
                  <button disabled={busy === c.id} onClick={() => resolveRefund(c.id)} className="ons-btn-primary text-xs">Refund</button>
                  <button disabled={busy === c.id} onClick={() => resolveRepair(c.id)} className="ons-btn-ghost text-xs">Repair</button>
                  <button disabled={busy === c.id} onClick={() => resolveReject(c.id)} className="ons-btn-ghost text-xs">Reject</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
