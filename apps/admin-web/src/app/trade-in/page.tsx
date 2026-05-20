'use client';

import * as React from 'react';
import type { TradeInGrade, TradeInModelRow } from '@onsective/api-client';
import { Badge } from '@onsective/ui';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function AdminTradeInPage() {
  const { user, loading } = useAuth();
  const [rows, setRows] = React.useState<TradeInModelRow[] | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [showCreate, setShowCreate] = React.useState(false);

  const [sourceProductId, setSourceProductId] = React.useState('');
  const [destinationProductId, setDestinationProductId] = React.useState('');
  const [baseOfferMinor, setBaseOfferMinor] = React.useState<number>(0);
  const [currency, setCurrency] = React.useState('USD');
  const [gradeA, setGradeA] = React.useState(0.85);
  const [gradeB, setGradeB] = React.useState(0.6);
  const [gradeC, setGradeC] = React.useState(0.3);
  const [accessoryRaw, setAccessoryRaw] = React.useState(
    JSON.stringify([{ key: 'box', amountMinor: 500, label: 'Original box' }], null, 2),
  );

  const load = React.useCallback(() => {
    api.tradeIn.adminModels().then(setRows).catch(() => setRows([]));
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function create() {
    setBusy(true); setErr(null);
    try {
      let accessoryAdjustments: Array<{ key: string; amountMinor: number; label?: string }> = [];
      try { accessoryAdjustments = JSON.parse(accessoryRaw); }
      catch { throw new Error('Accessory adjustments must be valid JSON'); }
      const gradeMultipliers: Record<TradeInGrade, number> = {
        GRADE_A: gradeA, GRADE_B: gradeB, GRADE_C: gradeC, REJECT: 0,
      };
      await api.tradeIn.adminCreateModel({
        sourceProductId, destinationProductId, baseOfferMinor, currency,
        gradeMultipliers, accessoryAdjustments,
      });
      setShowCreate(false);
      setSourceProductId(''); setDestinationProductId(''); setBaseOfferMinor(0);
      load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!rows) return <div className="container py-16 text-ink-400">Loading models…</div>;

  return (
    <div className="container py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Trade-in models</h1>
          <p className="text-sm text-ink-400 mt-1">
            Each model = "what we'll pay for product X, by grade". Graded units are
            re-listed against the destination refurb product.
          </p>
        </div>
        <button onClick={() => setShowCreate((v) => !v)} className="ons-btn-primary text-sm">
          {showCreate ? 'Cancel' : '+ New model'}
        </button>
      </div>

      {showCreate && (
        <div className="ons-card mb-6 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <input value={sourceProductId} onChange={(e) => setSourceProductId(e.target.value)}
                   placeholder="Source (new) product ID" className="ons-input" />
            <input value={destinationProductId} onChange={(e) => setDestinationProductId(e.target.value)}
                   placeholder="Destination refurb product ID" className="ons-input" />
            <input type="number" value={baseOfferMinor} onChange={(e) => setBaseOfferMinor(Number(e.target.value))}
                   placeholder="Base offer (minor units)" className="ons-input" />
            <input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                   placeholder="Currency" className="ons-input" />
            <input type="number" step="0.01" value={gradeA} onChange={(e) => setGradeA(Number(e.target.value))}
                   placeholder="Grade A multiplier" className="ons-input" />
            <input type="number" step="0.01" value={gradeB} onChange={(e) => setGradeB(Number(e.target.value))}
                   placeholder="Grade B multiplier" className="ons-input" />
            <input type="number" step="0.01" value={gradeC} onChange={(e) => setGradeC(Number(e.target.value))}
                   placeholder="Grade C multiplier" className="ons-input" />
          </div>
          <textarea value={accessoryRaw} onChange={(e) => setAccessoryRaw(e.target.value)}
                    className="ons-input font-mono text-xs min-h-[100px]" />
          {err && <div className="text-danger text-sm">{err}</div>}
          <button disabled={busy} onClick={create} className="ons-btn-primary">
            {busy ? 'Creating…' : 'Create model'}
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-ink-400">No trade-in models yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((m) => (
            <div key={m.id} className="ons-card">
              <div className="flex items-center gap-3">
                <Badge tone={m.enabled ? 'success' : 'neutral'}>{m.enabled ? 'ENABLED' : 'DISABLED'}</Badge>
                <div className="flex-1">
                  <p className="font-medium text-sm">
                    {m.sourceProduct?.title ?? m.sourceProductId} → {m.destinationProduct?.title ?? m.destinationProductId}
                  </p>
                  <p className="text-xs text-ink-400 mt-1">
                    Base {(m.baseOfferMinor / 100).toFixed(2)} {m.currency}
                    {' · '}A={(m.gradeMultipliers.GRADE_A ?? 0) * 100 | 0}%, B={(m.gradeMultipliers.GRADE_B ?? 0) * 100 | 0}%, C={(m.gradeMultipliers.GRADE_C ?? 0) * 100 | 0}%
                    {m.assignedRefurbiser && ` · refurbisher: ${m.assignedRefurbiser.displayName}`}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
