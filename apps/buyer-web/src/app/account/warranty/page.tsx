'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type { WarrantyClaimRow } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function WarrantyClaimsPage() {
  const { user, loading } = useAuth();
  const [rows, setRows] = React.useState<WarrantyClaimRow[] | null>(null);
  const [orderItemId, setOrderItemId] = React.useState('');
  const [symptom, setSymptom] = React.useState('');
  const [photoUrl, setPhotoUrl] = React.useState('');
  const [photoNote, setPhotoNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    api.warranty.mine().then(setRows).catch(() => setRows([]));
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function file() {
    setBusy(true); setErr(null);
    try {
      const evidence = [];
      if (photoUrl) evidence.push({ kind: 'PHOTO' as const, url: photoUrl, note: photoNote || undefined });
      if (photoNote && !photoUrl) evidence.push({ kind: 'NOTE' as const, url: '', note: photoNote });
      if (evidence.length === 0) throw new Error('Add at least a photo URL or note');
      await api.warranty.file({ orderItemId, symptom, evidence });
      setOrderItemId(''); setSymptom(''); setPhotoUrl(''); setPhotoNote('');
      load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!rows) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-10 space-y-8 max-w-3xl">
      <header>
        <h1 className="font-display text-3xl tracking-tight">Warranty claims</h1>
        <p className="text-sm text-ink-400 mt-1">
          File a defect claim. This is separate from a regular return — use this when a
          certified unit develops a problem within its warranty window.
        </p>
      </header>

      <section className="ons-card space-y-3">
        <h2 className="font-medium">File a new claim</h2>
        <input value={orderItemId} onChange={(e) => setOrderItemId(e.target.value)}
               placeholder="Order item ID (from your order page)" className="ons-input" />
        <textarea value={symptom} onChange={(e) => setSymptom(e.target.value)}
                  placeholder="Describe the symptom (min 10 characters)…" className="ons-input min-h-[100px]" />
        <input value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)}
               placeholder="Photo URL (paste image link)" className="ons-input" />
        <input value={photoNote} onChange={(e) => setPhotoNote(e.target.value)}
               placeholder="Photo note (optional)" className="ons-input" />
        {err && <div className="text-danger text-sm">{err}</div>}
        <button disabled={busy || !orderItemId || symptom.length < 10} onClick={file} className="ons-btn-primary">
          {busy ? 'Filing…' : 'File claim'}
        </button>
      </section>

      <section>
        <h2 className="font-medium mb-3">My claims</h2>
        {rows.length === 0 ? <p className="text-ink-400">No claims yet.</p> : (
          <div className="space-y-2">
            {rows.map((c) => <ClaimRow key={c.id} claim={c} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function ClaimRow({ claim }: { claim: WarrantyClaimRow }) {
  const [ticket, setTicket] = React.useState<Awaited<ReturnType<typeof api.repair.ticketForClaim>>>(null);
  React.useEffect(() => {
    if (claim.status === 'RESOLVED_REPAIR' || claim.resolutionRef?.startsWith('ticket:')) {
      api.repair.ticketForClaim(claim.id).then(setTicket).catch(() => setTicket(null));
    }
  }, [claim.id, claim.status, claim.resolutionRef]);

  return (
    <div className="ons-card">
      <div className="flex items-center gap-3">
        <Badge tone={
          claim.status === 'OPEN' || claim.status === 'APPROVED' ? 'warning'
          : claim.status === 'REJECTED' ? 'danger'
          : 'success'
        }>{claim.status}</Badge>
        <p className="text-sm flex-1">{claim.symptom}</p>
        <span className="text-xs text-ink-500">{new Date(claim.createdAt).toLocaleDateString()}</span>
      </div>
      {claim.resolutionNote && <p className="text-xs text-ink-400 mt-2">Resolution: {claim.resolutionNote}</p>}
      {ticket && (
        <div className="mt-3 border-t border-ink-800 pt-3 text-xs">
          <p className="text-ink-300">
            Repair ticket <Badge tone="neutral">{ticket.status}</Badge>
            {ticket.partner && <span className="ml-2 text-ink-400">· {ticket.partner.displayName}</span>}
          </p>
          {(ticket.inboundTracking || ticket.outboundTracking) && (
            <p className="text-ink-500 mt-1">
              {ticket.inboundTracking && <span>Inbound: {ticket.inboundCarrier} {ticket.inboundTracking}</span>}
              {ticket.inboundTracking && ticket.outboundTracking && <span> · </span>}
              {ticket.outboundTracking && <span>Outbound: {ticket.outboundCarrier} {ticket.outboundTracking}</span>}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
