'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type {
  PlatformTotalsResult,
  SustainabilityFactorRow,
} from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function AdminSustainabilityPage() {
  const { user, loading } = useAuth();
  const [factors, setFactors] = React.useState<SustainabilityFactorRow[] | null>(null);
  const [platform, setPlatform] = React.useState<PlatformTotalsResult | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const [categorySlug, setCategorySlug] = React.useState('');
  const [brandId, setBrandId] = React.useState('');
  const [kgCo2, setKgCo2] = React.useState(0);
  const [kgMat, setKgMat] = React.useState(0);
  const [years, setYears] = React.useState(0);
  const [notes, setNotes] = React.useState('');

  const load = React.useCallback(async () => {
    const [f, p] = await Promise.all([
      api.sustainability.adminListFactors().catch(() => []),
      api.sustainability.platform().catch(() => null),
    ]);
    setFactors(f);
    setPlatform(p);
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function save() {
    setBusy(true); setErr(null);
    try {
      await api.sustainability.adminUpsertFactor({
        categorySlug,
        brandId: brandId || undefined,
        kgCo2PerRefurb: kgCo2,
        kgMaterialPerRefurb: kgMat,
        lifeExtensionYears: years,
        notes: notes || undefined,
      });
      setCategorySlug(''); setBrandId(''); setKgCo2(0); setKgMat(0); setYears(0); setNotes('');
      load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  function editRow(f: SustainabilityFactorRow) {
    setCategorySlug(f.categorySlug);
    setBrandId(f.brandId ?? '');
    setKgCo2(f.kgCo2PerRefurb);
    setKgMat(f.kgMaterialPerRefurb);
    setYears(f.lifeExtensionYears);
    setNotes(f.notes ?? '');
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!factors) return <div className="container py-16 text-ink-400">Loading factors…</div>;

  return (
    <div className="container py-10 space-y-10">
      <header>
        <h1 className="font-display text-3xl tracking-tight">Sustainability</h1>
        <p className="text-sm text-ink-400 mt-1">
          Per-category baseline factors. Optional brand override beats the
          category-only row at lookup. Future events use the new values; existing impact rows
          are snapshotted and unaffected.
        </p>
      </header>

      {platform && (
        <section className="grid sm:grid-cols-4 gap-4">
          <StatCard label="kg CO₂ avoided" value={Math.round(platform.totals.kgCo2Saved).toLocaleString()} />
          <StatCard label="kg material" value={platform.totals.kgMaterialDiverted.toFixed(1)} />
          <StatCard label="life-years added" value={Math.round(platform.totals.lifeExtensionYears).toLocaleString()} />
          <StatCard label="events" value={platform.totals.events.toLocaleString()} />
        </section>
      )}

      <section>
        <h2 className="font-medium mb-3">Upsert factor</h2>
        <div className="ons-card space-y-3">
          <div className="grid sm:grid-cols-3 gap-3">
            <input value={categorySlug} onChange={(e) => setCategorySlug(e.target.value)} placeholder="Category slug (e.g. phones)" className="ons-input" />
            <input value={brandId} onChange={(e) => setBrandId(e.target.value)} placeholder="Brand ID (optional override)" className="ons-input" />
            <input type="number" min={0} step={0.5} value={kgCo2} onChange={(e) => setKgCo2(Number(e.target.value))} placeholder="kg CO₂ per refurb" className="ons-input" />
            <input type="number" min={0} step={0.01} value={kgMat} onChange={(e) => setKgMat(Number(e.target.value))} placeholder="kg material per refurb" className="ons-input" />
            <input type="number" min={0} step={0.1} value={years} onChange={(e) => setYears(Number(e.target.value))} placeholder="Life extension years" className="ons-input" />
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" className="ons-input" />
          </div>
          {err && <div className="text-danger text-sm">{err}</div>}
          <button disabled={busy || !categorySlug} onClick={save} className="ons-btn-primary">
            {busy ? 'Saving…' : 'Save factor'}
          </button>
        </div>
      </section>

      <section>
        <h2 className="font-medium mb-3">Factors ({factors.length})</h2>
        {factors.length === 0 ? <p className="text-ink-400">No factors yet — add one above.</p> : (
          <div className="space-y-1">
            {factors.map((f) => (
              <div key={f.id} className="ons-card flex items-center gap-3 text-sm">
                <code className="text-xs text-ink-400 w-40 truncate">{f.categorySlug}</code>
                {f.brandId ? <Badge tone="neutral">brand {f.brandId.slice(-6)}</Badge> : <span className="text-xs text-ink-500">— (default)</span>}
                <span className="flex-1 text-xs text-ink-300">
                  {f.kgCo2PerRefurb}kg CO₂ · {f.kgMaterialPerRefurb}kg material · {f.lifeExtensionYears}yr life
                </span>
                <button onClick={() => editRow(f)} className="ons-btn-ghost text-xs">Edit</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="ons-card text-center">
      <p className="text-xs uppercase tracking-wider text-ink-400">{label}</p>
      <p className="font-display text-2xl mt-2">{value}</p>
    </div>
  );
}
