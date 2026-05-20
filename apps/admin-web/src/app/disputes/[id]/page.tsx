'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@onsective/ui';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const OUTCOMES = [
  { value: 'RESOLVED_BUYER', label: 'Refund buyer (full or specified amount)' },
  { value: 'RESOLVED_SPLIT', label: 'Split — partial refund to buyer' },
  { value: 'RESOLVED_SELLER', label: 'Side with seller (no refund)' },
  { value: 'CLOSED_NO_ACTION', label: 'Close without action' },
] as const;

export default function DisputeDetail() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading } = useAuth();
  const [d, setD] = React.useState<any>(null);
  const [outcome, setOutcome] = React.useState<typeof OUTCOMES[number]['value']>('RESOLVED_BUYER');
  const [note, setNote] = React.useState('');
  const [amount, setAmount] = React.useState<string>('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (loading || !user) return;
    api.disputes.adminGet(params.id).then(setD).catch((e) => setErr(e?.message ?? 'Failed'));
  }, [loading, user, params.id]);

  async function resolve() {
    if (!note.trim()) { setErr('Resolution note is required'); return; }
    setBusy(true); setErr(null);
    try {
      const body: any = { outcome, note: note.trim() };
      if (amount) body.resolutionMinor = Math.round(Number(amount) * 100);
      await api.disputes.resolve(params.id, body);
      router.push('/disputes');
    } catch (e) {
      setErr((e as Error).message); setBusy(false);
    }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (err && !d) return <div className="container py-16 text-danger">{err}</div>;
  if (!d) return <div className="container py-16 text-ink-400">Loading dispute…</div>;

  return (
    <div className="container py-10 max-w-3xl">
      <Link href="/disputes" className="ons-btn-ghost text-sm">← back</Link>
      <h1 className="font-display text-3xl tracking-tight mt-3 mb-6">{d.kind} dispute · {d.status}</h1>
      <div className="ons-card mb-6 space-y-2">
        <div className="text-sm text-ink-300">Opened {new Date(d.openedAt).toLocaleString()}</div>
        {d.thread?.order && (
          <div>Order #{d.thread.order.id.slice(-8)} — ${(d.thread.order.totalMinor / 100).toFixed(2)} {d.thread.order.currency} ({d.thread.order.status})</div>
        )}
        {d.return && <div className="text-sm">Linked return: #{d.return.id.slice(-8)} ({d.return.status})</div>}
      </div>

      {d.thread && (
        <div className="ons-card mb-6">
          <h2 className="font-medium mb-3">Thread</h2>
          <div className="space-y-2 max-h-[40vh] overflow-y-auto">
            {d.thread.messages?.map((m: any) => (
              <div key={m.id} className="text-sm border-b border-ink-800 pb-2 last:border-0">
                <div className="text-xs text-ink-400">{m.senderKind} · {new Date(m.createdAt).toLocaleString()}</div>
                <div className="whitespace-pre-wrap">{m.body}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {d.status === 'OPEN' && (
        <div className="ons-card space-y-3">
          <h2 className="font-medium">Resolve</h2>
          <div>
            <label className="block text-sm text-ink-300 mb-1">Outcome</label>
            <select value={outcome} onChange={(e) => setOutcome(e.target.value as any)} className="ons-input w-full">
              {OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {(outcome === 'RESOLVED_BUYER' || outcome === 'RESOLVED_SPLIT') && d.kind !== 'CHARGEBACK' && (
            <div>
              <label className="block text-sm text-ink-300 mb-1">Refund amount (leave blank for full)</label>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" min="0" className="ons-input w-full" placeholder="0.00" />
            </div>
          )}
          <div>
            <label className="block text-sm text-ink-300 mb-1">Resolution note</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="ons-input w-full" />
          </div>
          {err && <div className="text-danger text-sm">{err}</div>}
          <button disabled={busy} onClick={resolve} className="ons-btn-primary">
            {busy ? 'Resolving…' : 'Resolve dispute'}
          </button>
        </div>
      )}
    </div>
  );
}
