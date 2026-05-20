'use client';

import * as React from 'react';
import { Badge, Money } from '@onsective/ui';
import type { QuoteResponse, TradeInGrade } from '@onsective/api-client';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const ACCESSORIES = [
  { key: 'box', label: 'Original box' },
  { key: 'charger', label: 'Original charger / cable' },
  { key: 'manual', label: 'Manual / receipt' },
];

export default function TradeInPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [slug, setSlug] = React.useState('');
  const [grade, setGrade] = React.useState<TradeInGrade>('GRADE_A');
  const [accessories, setAccessories] = React.useState<string[]>(['box']);
  const [quote, setQuote] = React.useState<QuoteResponse | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  function toggleAccessory(key: string) {
    setAccessories((cur) =>
      cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key],
    );
  }

  async function requestQuote() {
    setBusy(true); setErr(null); setQuote(null);
    try {
      const q = await api.tradeIn.quote({ productSlug: slug, declaredGrade: grade, accessories });
      setQuote(q);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function accept() {
    if (!quote) return;
    if (!user) { router.push(`/login?next=/trade-in`); return; }
    setBusy(true); setErr(null);
    try {
      const order = await api.tradeIn.accept({
        ...quote,
        declaredGrade: grade,
        accessories,
      });
      router.push(`/account/trade-ins?just=${order.id}`);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="container py-12 max-w-2xl">
      <h1 className="font-display text-3xl tracking-tight">Trade in your device</h1>
      <p className="text-sm text-ink-400 mt-2 mb-8">
        Quote in seconds. Ship for free with a label we email you. Get paid as wallet
        credit the moment our team finishes grading.
      </p>

      <div className="ons-card space-y-4">
        <div>
          <label className="text-xs uppercase tracking-wider text-ink-400">Product slug</label>
          <input value={slug} onChange={(e) => setSlug(e.target.value)} className="ons-input mt-1"
                 placeholder="e.g. iphone-13" />
          <p className="text-xs text-ink-500 mt-1">Find the slug in any product URL: <code>/p/&lt;slug&gt;</code>.</p>
        </div>

        <div>
          <label className="text-xs uppercase tracking-wider text-ink-400">Self-assessed condition</label>
          <div className="grid grid-cols-3 gap-2 mt-2">
            {(['GRADE_A', 'GRADE_B', 'GRADE_C'] as TradeInGrade[]).map((g) => (
              <button key={g} type="button" onClick={() => setGrade(g)}
                      className={[
                        'rounded-lg border px-3 py-2 text-sm transition-colors',
                        grade === g ? 'border-gold-500 bg-gold-500/10 text-gold-200' : 'border-ink-800 text-ink-300',
                      ].join(' ')}>
                {g.replace('GRADE_', 'Grade ')}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs uppercase tracking-wider text-ink-400">Accessories included</label>
          <div className="flex flex-wrap gap-2 mt-2">
            {ACCESSORIES.map((a) => (
              <button key={a.key} type="button" onClick={() => toggleAccessory(a.key)}
                      className={[
                        'rounded-full border px-3 py-1 text-xs transition-colors',
                        accessories.includes(a.key) ? 'border-emerald-500 bg-emerald-500/10 text-emerald-200' : 'border-ink-800 text-ink-300',
                      ].join(' ')}>
                {a.label}
              </button>
            ))}
          </div>
        </div>

        {err && <div className="text-danger text-sm">{err}</div>}
        <button disabled={busy || !slug} onClick={requestQuote} className="ons-btn-primary">
          {busy ? 'Getting quote…' : 'Get my quote'}
        </button>
      </div>

      {quote && (
        <div className="ons-card mt-6 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wider text-ink-400">Our offer</p>
              <Money amountMinor={quote.offerMinor} currency={quote.currency as 'USD'} emphasized />
            </div>
            <Badge tone="success">Valid 24h</Badge>
          </div>
          <p className="text-xs text-ink-400">
            Final payout adjusts if our techs grade your device lower than {grade.replace('GRADE_', 'Grade ')}.
            Accept to get a prepaid ship-back label.
          </p>
          <button disabled={busy} onClick={accept} className="ons-btn-primary w-full">
            {busy ? 'Accepting…' : 'Accept offer & send shipping label'}
          </button>
        </div>
      )}
    </div>
  );
}
