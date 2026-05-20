'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type { PromotionRow, PromotionKind, PromotionStatus } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const KINDS: PromotionKind[] = ['PERCENT_OFF', 'AMOUNT_OFF', 'FREE_SHIPPING', 'BOGO'];

function tone(s: PromotionStatus): 'success' | 'danger' | 'neutral' {
  if (s === 'ACTIVE') return 'success';
  if (s === 'ARCHIVED') return 'neutral';
  return 'danger';
}

export default function SellerPromotionsPage() {
  const { user, loading } = useAuth();
  const [rows, setRows] = React.useState<PromotionRow[] | null>(null);
  const [showCreate, setShowCreate] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const [code, setCode] = React.useState('');
  const [kind, setKind] = React.useState<PromotionKind>('PERCENT_OFF');
  const [value, setValue] = React.useState('');
  const [minSub, setMinSub] = React.useState('');
  const [perUser, setPerUser] = React.useState('');
  const [total, setTotal] = React.useState('');

  const load = React.useCallback(() => {
    api.promotions.listForSeller().then(setRows).catch(() => setRows([]));
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function create() {
    setCreating(true); setErr(null);
    try {
      const valueBpOrMinor = kind === 'PERCENT_OFF'
        ? Math.round(Number(value) * 100) // user enters 10 → 10% → 1000bp
        : Math.round(Number(value) * 100); // cents for AMOUNT_OFF
      await api.promotions.createForSeller({
        code: code.toUpperCase(),
        kind, scope: 'SELLER',
        valueBpOrMinor,
        minSubtotalMinor: minSub ? Math.round(Number(minSub) * 100) : undefined,
        perUserLimit: perUser ? Number(perUser) : undefined,
        totalLimit: total ? Number(total) : undefined,
      });
      setShowCreate(false);
      setCode(''); setValue(''); setMinSub(''); setPerUser(''); setTotal('');
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function toggle(p: PromotionRow) {
    const next: PromotionStatus = p.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    await api.promotions.updateForSeller(p.id, { status: next });
    load();
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!rows) return <div className="container py-16 text-ink-400">Loading promotions…</div>;

  return (
    <div className="container py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-3xl tracking-tight">Promotions</h1>
        <button onClick={() => setShowCreate((v) => !v)} className="ons-btn-primary text-sm">
          {showCreate ? 'Cancel' : '+ New code'}
        </button>
      </div>

      {showCreate && (
        <div className="ons-card mb-6 space-y-3">
          <h2 className="font-medium">New promotion</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CODE (uppercase)" className="ons-input" />
            <select value={kind} onChange={(e) => setKind(e.target.value as PromotionKind)} className="ons-input">
              {KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
            </select>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={kind === 'PERCENT_OFF' ? 'Percent (e.g. 10 = 10%)' : kind === 'AMOUNT_OFF' ? 'Amount in dollars' : 'n/a'}
              className="ons-input"
              disabled={kind === 'FREE_SHIPPING' || kind === 'BOGO'}
              type="number" step="0.01" min="0"
            />
            <input value={minSub} onChange={(e) => setMinSub(e.target.value)} placeholder="Min subtotal $" className="ons-input" type="number" step="0.01" />
            <input value={perUser} onChange={(e) => setPerUser(e.target.value)} placeholder="Per-user limit" className="ons-input" type="number" min="1" />
            <input value={total} onChange={(e) => setTotal(e.target.value)} placeholder="Total limit" className="ons-input" type="number" min="1" />
          </div>
          {err && <div className="text-danger text-sm">{err}</div>}
          <button disabled={creating || !code} onClick={create} className="ons-btn-primary">
            {creating ? 'Creating…' : 'Create code'}
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-ink-400">No promotions yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((p) => (
            <div key={p.id} className="ons-card flex items-center gap-4">
              <div className="flex-1">
                <div className="font-mono font-medium">{p.code}</div>
                <div className="text-xs text-ink-400">
                  {p.kind.replace(/_/g, ' ')}
                  {p.kind === 'PERCENT_OFF' && ` · ${(p.valueBpOrMinor / 100).toFixed(2)}%`}
                  {p.kind === 'AMOUNT_OFF' && ` · $${(p.valueBpOrMinor / 100).toFixed(2)} off`}
                  {p.perUserLimit && ` · max ${p.perUserLimit}/user`}
                  {p._count && ` · ${p._count.redemptions} used`}
                </div>
              </div>
              <Badge tone={tone(p.status)}>{p.status}</Badge>
              <button onClick={() => toggle(p)} className="ons-btn-ghost text-sm">
                {p.status === 'ACTIVE' ? 'Pause' : 'Activate'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
