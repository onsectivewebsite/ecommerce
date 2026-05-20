'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type { ServiceTicketRow, ServiceTicketStatus } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const NEXT_STEP: Partial<Record<ServiceTicketStatus, ServiceTicketStatus>> = {
  ASSIGNED: 'INBOUND',
  INBOUND: 'RECEIVED',
  RECEIVED: 'DIAGNOSING',
  DIAGNOSING: 'REPAIRING',
  REPAIRING: 'OUTBOUND',
  OUTBOUND: 'COMPLETED',
};

export default function PartnerRepairPage() {
  const { user, loading } = useAuth();
  const [rows, setRows] = React.useState<ServiceTicketRow[] | null>(null);
  const [openFor, setOpenFor] = React.useState<string | null>(null);
  const [note, setNote] = React.useState('');
  const [parts, setParts] = React.useState<number>(0);
  const [carrier, setCarrier] = React.useState('');
  const [tracking, setTracking] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    api.repairNetwork.myQueue().then(setRows).catch((e) => {
      setRows([]);
      // 403 means "not a repair partner" — show a clear hint instead of "empty queue".
      if ((e as Error).message?.includes('Not a repair partner')) {
        setErr('This account is not registered as a repair partner. Ask an admin to register you.');
      }
    });
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function advance(t: ServiceTicketRow) {
    const next = NEXT_STEP[t.status];
    if (!next) return;
    setBusy(t.id); setErr(null);
    try {
      await api.repairNetwork.partnerUpdate(t.id, {
        status: next,
        partnerNote: note || undefined,
        estimatedPartsCostMinor: parts > 0 ? parts : undefined,
        // When moving INBOUND or OUTBOUND, attach tracking if entered.
        inboundCarrier: next === 'INBOUND' ? carrier || undefined : undefined,
        inboundTracking: next === 'INBOUND' ? tracking || undefined : undefined,
        outboundCarrier: next === 'OUTBOUND' ? carrier || undefined : undefined,
        outboundTracking: next === 'OUTBOUND' ? tracking || undefined : undefined,
      });
      setOpenFor(null); setNote(''); setParts(0); setCarrier(''); setTracking('');
      load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!rows) return <div className="container py-16 text-ink-400">Loading queue…</div>;

  return (
    <div className="container py-10">
      <header className="mb-6">
        <h1 className="font-display text-3xl tracking-tight">Repair queue</h1>
        <p className="text-sm text-ink-400 mt-1">Your active service tickets. Move tickets forward as the device progresses.</p>
      </header>

      {err && <div className="text-danger text-sm mb-4">{err}</div>}

      {rows.length === 0 ? <p className="text-ink-400">No active tickets.</p> : (
        <div className="space-y-3">
          {rows.map((t) => (
            <div key={t.id} className="ons-card">
              <div className="flex items-center gap-3 flex-wrap">
                <Badge tone={
                  t.status === 'OUTBOUND' ? 'success'
                  : t.status === 'ASSIGNED' || t.status === 'INBOUND' ? 'warning'
                  : 'neutral'
                }>{t.status}</Badge>
                <div className="flex-1 min-w-[220px]">
                  <p className="font-medium text-sm">{t.warrantyClaim?.orderItem?.productTitleSnapshot ?? 'Repair'}</p>
                  <p className="text-xs text-ink-400 mt-1">{t.warrantyClaim?.symptom}</p>
                  {t.inboundTracking && (
                    <p className="text-xs text-ink-400 mt-1">Inbound: {t.inboundCarrier} {t.inboundTracking}</p>
                  )}
                  {t.outboundTracking && (
                    <p className="text-xs text-ink-400 mt-1">Outbound: {t.outboundCarrier} {t.outboundTracking}</p>
                  )}
                </div>
                <button onClick={() => setOpenFor(openFor === t.id ? null : t.id)} className="ons-btn-ghost text-sm">
                  {openFor === t.id ? 'Close' : 'Update'}
                </button>
              </div>

              {openFor === t.id && (
                <div className="mt-3 border-t border-ink-800 pt-3 space-y-2">
                  {NEXT_STEP[t.status] ? (
                    <p className="text-xs text-ink-300">
                      Next step: <span className="font-medium">{NEXT_STEP[t.status]}</span>
                    </p>
                  ) : (
                    <p className="text-xs text-ink-400">No further forward step available.</p>
                  )}
                  <textarea value={note} onChange={(e) => setNote(e.target.value)}
                            placeholder="Note (optional)" className="ons-input min-h-[60px]" />
                  {NEXT_STEP[t.status] === 'INBOUND' || NEXT_STEP[t.status] === 'OUTBOUND' ? (
                    <div className="grid sm:grid-cols-2 gap-2">
                      <input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="Carrier" className="ons-input" />
                      <input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Tracking number" className="ons-input" />
                    </div>
                  ) : null}
                  <input type="number" min={0} value={parts} onChange={(e) => setParts(Number(e.target.value))}
                         placeholder="Estimated parts cost (minor units, optional)" className="ons-input max-w-sm" />
                  <button disabled={busy === t.id || !NEXT_STEP[t.status]} onClick={() => advance(t)} className="ons-btn-primary text-sm">
                    Advance to {NEXT_STEP[t.status] ?? '—'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
