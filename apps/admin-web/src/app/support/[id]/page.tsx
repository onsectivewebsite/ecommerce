'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Badge, Money } from '@onsective/ui';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function SupportThreadPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading } = useAuth();
  const [t, setT] = React.useState<any>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const [refundAmount, setRefundAmount] = React.useState('');
  const [refundReason, setRefundReason] = React.useState('');
  const [override, setOverride] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try { setT(await api.support.thread(params.id)); }
    catch (e) { setErr((e as Error).message); }
  }, [params.id]);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function addNote() {
    const body = prompt('Internal note (visible only to admins):');
    if (!body) return;
    await api.support.note(params.id, { body });
    await load();
  }

  async function escalate() {
    const reason = prompt('Reason for escalation:');
    if (!reason) return;
    await api.support.escalate(params.id, { reason });
    await load();
  }

  async function resolve() {
    if (!confirm('Mark this thread resolved?')) return;
    await api.support.resolve(params.id);
    router.push('/support');
  }

  async function refund() {
    if (!refundAmount || !refundReason) { setErr('Amount and reason are required'); return; }
    setBusy(true); setErr(null);
    try {
      await api.support.platformRefund(params.id, {
        amountMinor: Math.round(Number(refundAmount) * 100),
        reason: refundReason,
        override,
      });
      router.push('/support');
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (err && !t) return <div className="container py-16 text-danger">{err}</div>;
  if (!t) return <div className="container py-16 text-ink-400">Loading thread…</div>;

  return (
    <div className="container py-10 max-w-3xl">
      <Link href="/support" className="ons-btn-ghost text-sm">← back</Link>
      <div className="flex items-center justify-between mt-3 mb-6">
        <h1 className="font-display text-2xl tracking-tight">
          Support · order #{t.order.id.slice(-8)}
        </h1>
        <Badge tone={t.status === 'ESCALATED' ? 'danger' : 'neutral'}>{t.status}</Badge>
      </div>

      <div className="ons-card mb-6 space-y-2 text-sm">
        <div>
          <span className="text-ink-400">Buyer:</span> {t.buyer.firstName} {t.buyer.lastName} ({t.buyer.email})
        </div>
        <div>
          <span className="text-ink-400">Seller:</span> {t.seller.displayName}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-ink-400">Order total:</span>
          <Money amountMinor={t.order.totalMinor} currency={t.order.currency} />
          <span className="text-ink-400">({t.order.status})</span>
        </div>
        {t.dispute && <div><span className="text-ink-400">Dispute:</span> #{t.dispute.id.slice(-8)} ({t.dispute.kind}/{t.dispute.status})</div>}
      </div>

      <div className="ons-card mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">Conversation</h2>
          <div className="flex gap-2">
            <button onClick={addNote} className="ons-btn-ghost text-sm">+ Internal note</button>
            <button onClick={escalate} className="ons-btn-ghost text-sm">Escalate</button>
            <button onClick={resolve} className="ons-btn-ghost text-sm">Resolve</button>
          </div>
        </div>
        <div className="space-y-2 max-h-[40vh] overflow-y-auto">
          {t.messages.map((m: any) => (
            <div key={m.id} className={`text-sm border-b border-ink-800 pb-2 last:border-0 ${m.body.startsWith('[INTERNAL]') ? 'opacity-70' : ''}`}>
              <div className="text-xs text-ink-400">{m.senderKind} · {new Date(m.createdAt).toLocaleString()}</div>
              <div className="whitespace-pre-wrap">{m.body}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="ons-card space-y-3">
        <h2 className="font-medium">Platform-funded refund</h2>
        <p className="text-xs text-ink-400">
          Allowed when thread is escalated or seller is past SLA. Use override (with care) for exceptional cases.
        </p>
        <div className="flex gap-2">
          <input value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} type="number" step="0.01" min="0" placeholder="Amount" className="ons-input flex-1" />
          <input value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="Reason" className="ons-input flex-[2]" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
          Override SLA gate (logged)
        </label>
        {err && <div className="text-danger text-sm">{err}</div>}
        <button disabled={busy} onClick={refund} className="ons-btn-primary">
          {busy ? 'Refunding…' : 'Issue platform refund'}
        </button>
      </div>
    </div>
  );
}
