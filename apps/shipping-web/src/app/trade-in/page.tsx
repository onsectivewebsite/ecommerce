'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type { AiSignal, GradeSuggestResult, TradeInGrade, TradeInOrderRow } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { AiSuggestionPanel } from '@/components/AiSuggestionPanel';

export default function ShippingTradeInPage() {
  const { user, loading } = useAuth();
  const [rows, setRows] = React.useState<TradeInOrderRow[] | null>(null);
  const [openFor, setOpenFor] = React.useState<string | null>(null);
  const [photos, setPhotos] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [grade, setGrade] = React.useState<TradeInGrade>('GRADE_A');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [aiByOrder, setAiByOrder] = React.useState<Record<string, GradeSuggestResult | { error: string } | null>>({});

  const load = React.useCallback(() => {
    api.tradeIn.warehouseQueue().then(setRows).catch(() => setRows([]));
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function intake(o: TradeInOrderRow) {
    setBusy(o.id); setErr(null);
    try {
      await api.tradeIn.intake({
        orderId: o.id,
        photoUrls: photos.split(',').map((s) => s.trim()).filter(Boolean),
        conditionNotes: notes || undefined,
      });
      setPhotos(''); setNotes('');
      load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  async function fetchAi(o: TradeInOrderRow) {
    setAiByOrder((cur) => ({ ...cur, [o.id]: null }));
    try {
      const res = await api.aiVision.suggestGrading({
        inputRefKind: 'tradeInOrder',
        inputRefId: o.id,
        productSlug: o.model?.sourceProduct?.slug,
        mediaUrls: [],
        attributes: { declaredGrade: o.declaredGrade, accessories: o.accessories },
      });
      setAiByOrder((cur) => ({ ...cur, [o.id]: res }));
      // Pre-fill grade with the suggested grade so technician confirms rather than originates.
      setGrade(res.suggestedGrade);
    } catch (e) {
      setAiByOrder((cur) => ({ ...cur, [o.id]: { error: (e as Error).message } }));
    }
  }

  async function gradeIt(o: TradeInOrderRow) {
    setBusy(o.id); setErr(null);
    try {
      await api.tradeIn.grade({
        orderId: o.id,
        actualGrade: grade,
        notes: notes || undefined,
      });
      setOpenFor(null); setNotes(''); load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!rows) return <div className="container py-16 text-ink-400">Loading queue…</div>;

  return (
    <div className="container py-10">
      <header className="mb-6">
        <h1 className="font-display text-3xl tracking-tight">Trade-in intake</h1>
        <p className="text-sm text-ink-400 mt-1">Receive, inspect, and grade incoming trade-in devices.</p>
      </header>

      {err && <div className="text-danger text-sm mb-4">{err}</div>}

      {rows.length === 0 ? <p className="text-ink-400">Queue empty.</p> : (
        <div className="space-y-3">
          {rows.map((o) => (
            <div key={o.id} className="ons-card">
              <div className="flex items-center gap-3 flex-wrap">
                <Badge tone={o.status === 'RECEIVED' ? 'success' : 'warning'}>{o.status}</Badge>
                <div className="flex-1 min-w-[200px]">
                  <p className="font-medium text-sm">{o.model?.sourceProduct?.title ?? 'Trade-in'}</p>
                  <p className="text-xs text-ink-400 mt-1">
                    Declared {o.declaredGrade.replace('GRADE_', 'Grade ')}
                    {' · offer '}{(o.offerMinor / 100).toFixed(2)} {o.currency}
                    {o.shipBackTracking && ` · tracking ${o.shipBackTracking}`}
                  </p>
                </div>
                <button onClick={() => {
                  const next = openFor === o.id ? null : o.id;
                  setOpenFor(next);
                  if (next && o.status === 'RECEIVED' && !aiByOrder[o.id]) fetchAi(o);
                }} className="ons-btn-ghost text-sm">
                  {openFor === o.id ? 'Close' : o.status === 'RECEIVED' ? 'Grade' : 'Intake'}
                </button>
              </div>

              {openFor === o.id && (
                <div className="mt-4 border-t border-ink-800 pt-4 space-y-3">
                  {o.status !== 'RECEIVED' ? (
                    <>
                      <input value={photos} onChange={(e) => setPhotos(e.target.value)}
                             placeholder="Intake photo URLs (comma-separated)" className="ons-input" />
                      <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                                placeholder="Condition notes" className="ons-input min-h-[80px]" />
                      <button disabled={busy === o.id} onClick={() => intake(o)} className="ons-btn-primary text-sm">
                        Record intake
                      </button>
                    </>
                  ) : (
                    <>
                      <AiSuggestionPanel
                        loading={aiByOrder[o.id] === null}
                        error={aiByOrder[o.id] && 'error' in (aiByOrder[o.id] as any) ? (aiByOrder[o.id] as any).error : null}
                        suggestion={aiByOrder[o.id] && 'suggestedGrade' in (aiByOrder[o.id] as any) ? (aiByOrder[o.id] as GradeSuggestResult).suggestedGrade : null}
                        confidence={aiByOrder[o.id] && 'confidence' in (aiByOrder[o.id] as any) ? (aiByOrder[o.id] as GradeSuggestResult).confidence : null}
                        signals={aiByOrder[o.id] && 'signals' in (aiByOrder[o.id] as any) ? ((aiByOrder[o.id] as GradeSuggestResult).signals as AiSignal[]) : []}
                        runId={aiByOrder[o.id] && 'runId' in (aiByOrder[o.id] as any) ? (aiByOrder[o.id] as GradeSuggestResult).runId : null}
                        kind="GRADE"
                      />
                      <div className="grid grid-cols-4 gap-2">
                        {(['GRADE_A', 'GRADE_B', 'GRADE_C', 'REJECT'] as TradeInGrade[]).map((g) => (
                          <button key={g} type="button" onClick={() => setGrade(g)}
                                  className={[
                                    'rounded-lg border px-3 py-2 text-xs',
                                    grade === g ? 'border-gold-500 bg-gold-500/10 text-gold-200' : 'border-ink-800 text-ink-300',
                                  ].join(' ')}>{g.replace('GRADE_', 'Grade ')}</button>
                        ))}
                      </div>
                      <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                                placeholder="Grading notes (mandatory on REJECT)" className="ons-input min-h-[80px]" />
                      <button disabled={busy === o.id || (grade === 'REJECT' && !notes)} onClick={() => gradeIt(o)} className="ons-btn-primary text-sm">
                        Submit grade
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
