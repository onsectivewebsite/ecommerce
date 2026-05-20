'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Badge, Money } from '@onsective/ui';
import type { RiskAssessmentRow } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function RiskDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading } = useAuth();
  const [assessment, setAssessment] = React.useState<RiskAssessmentRow | null>(null);
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (loading || !user) return;
    api.risk.assessment(params.id).then(setAssessment).catch((e) => setErr(e?.message ?? 'Failed'));
  }, [loading, user, params.id]);

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (err) return <div className="container py-16 text-danger">{err}</div>;
  if (!assessment) return <div className="container py-16 text-ink-400">Loading…</div>;

  async function decide(action: 'release' | 'cancel') {
    if (!note.trim()) { setErr('A review note is required.'); return; }
    setBusy(true); setErr(null);
    try {
      if (action === 'release') await api.risk.release(params.id, note.trim());
      else await api.risk.cancel(params.id, note.trim());
      router.push('/risk');
    } catch (e) {
      setErr((e as Error).message); setBusy(false);
    }
  }

  return (
    <div className="container py-10 max-w-3xl">
      <Link href="/risk" className="ons-btn-ghost text-sm">← back</Link>
      <h1 className="font-display text-3xl tracking-tight mt-3 mb-6">
        Risk · Order #{assessment.order.id.slice(-8)}
      </h1>

      <div className="ons-card mb-6 flex items-center gap-4">
        <div className="flex-1">
          <div className="text-sm text-ink-300">Total order</div>
          <Money amountMinor={assessment.order.totalMinor} currency={assessment.order.currency} emphasized />
        </div>
        <Badge tone={assessment.decision === 'BLOCK' ? 'danger' : assessment.decision === 'HOLD' ? 'warning' : 'success'}>
          {assessment.decision} · score {assessment.score}
        </Badge>
      </div>

      <div className="ons-card mb-6">
        <h2 className="font-medium mb-3">Rule hits</h2>
        {assessment.hits.length === 0 ? (
          <p className="text-ink-400 text-sm">No rules triggered.</p>
        ) : (
          <div className="space-y-2">
            {assessment.hits.map((h) => (
              <div key={h.id} className="flex items-center justify-between text-sm border-b border-ink-800 last:border-0 py-2">
                <div>
                  <code className="text-xs">{h.code}</code>
                  <div className="text-ink-300">{h.reason}</div>
                </div>
                <span className="font-mono">+{h.score}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="ons-card space-y-3">
        <h2 className="font-medium">Decision</h2>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Review note (required, logged in audit trail)"
          className="ons-input w-full"
        />
        {err && <div className="text-danger text-sm">{err}</div>}
        <div className="flex gap-2">
          <button disabled={busy} onClick={() => decide('release')} className="ons-btn-primary">
            Release order
          </button>
          <button disabled={busy} onClick={() => decide('cancel')} className="ons-btn-ghost text-danger">
            Cancel order
          </button>
        </div>
      </div>
    </div>
  );
}
