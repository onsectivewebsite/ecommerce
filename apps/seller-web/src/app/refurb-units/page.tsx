'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type { RefurbUnitRow } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function SellerRefurbUnitsPage() {
  const { user, loading } = useAuth();
  const [rows, setRows] = React.useState<RefurbUnitRow[] | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const [productId, setProductId] = React.useState('');
  const [serial, setSerial] = React.useState('');
  const [imei, setImei] = React.useState('');
  const [priceMinor, setPriceMinor] = React.useState<number>(0);
  const [photos, setPhotos] = React.useState('');
  const [reportRaw, setReportRaw] = React.useState('{}');

  const load = React.useCallback(() => {
    api.refurbUnits.mine().then(setRows).catch(() => setRows([]));
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function create() {
    setBusy(true); setErr(null);
    try {
      let report: Record<string, unknown> = {};
      try { report = JSON.parse(reportRaw); }
      catch { throw new Error('Condition report must be valid JSON'); }
      await api.refurbUnits.create({
        productId,
        serialNumber: serial,
        imei: imei || undefined,
        priceMinor,
        conditionReport: report,
        unitPhotoMediaIds: photos.split(',').map((s) => s.trim()).filter(Boolean),
      });
      setProductId(''); setSerial(''); setImei(''); setPriceMinor(0); setPhotos(''); setReportRaw('{}');
      load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function withdraw(id: string) {
    if (!confirm('Withdraw this unit from sale?')) return;
    await api.refurbUnits.update(id, { withdraw: true });
    load();
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!rows) return <div className="container py-16 text-ink-400">Loading refurb units…</div>;

  return (
    <div className="container py-10 space-y-8">
      <header>
        <h1 className="font-display text-3xl tracking-tight">Refurbished units</h1>
        <p className="text-sm text-ink-400 mt-1">
          Each physical refurbished unit is its own listing. Units stay quarantined until an
          authenticity check passes at the receiving warehouse.
        </p>
      </header>

      <section>
        <h2 className="font-medium mb-3">List a new unit</h2>
        <div className="ons-card space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <input value={productId} onChange={(e) => setProductId(e.target.value)}
                   placeholder="Refurb product ID (the parent shell)" className="ons-input" />
            <input value={serial} onChange={(e) => setSerial(e.target.value)}
                   placeholder="Serial number" className="ons-input" />
            <input value={imei} onChange={(e) => setImei(e.target.value)}
                   placeholder="IMEI (phones, optional)" className="ons-input" />
            <input type="number" value={priceMinor} onChange={(e) => setPriceMinor(Number(e.target.value))}
                   placeholder="Price (minor units)" className="ons-input" />
            <input value={photos} onChange={(e) => setPhotos(e.target.value)}
                   placeholder="Unit photo media IDs (comma-separated)" className="ons-input sm:col-span-2" />
          </div>
          <textarea value={reportRaw} onChange={(e) => setReportRaw(e.target.value)}
                    placeholder='{"batteryHealth": 92, "replacedParts": ["screen"]}'
                    className="ons-input min-h-[80px] font-mono text-sm" />
          {err && <div className="text-danger text-sm">{err}</div>}
          <button disabled={busy || !productId || !serial || !priceMinor} onClick={create} className="ons-btn-primary">
            {busy ? 'Creating…' : 'Create unit'}
          </button>
        </div>
      </section>

      <section>
        <h2 className="font-medium mb-3">My units</h2>
        {rows.length === 0 ? <p className="text-ink-400">No units yet.</p> : (
          <div className="space-y-2">
            {rows.map((u) => (
              <div key={u.id} className="ons-card flex items-center gap-3">
                <Badge tone={
                  u.availability === 'AVAILABLE' ? 'success'
                  : u.availability === 'SOLD' ? 'neutral'
                  : u.availability === 'QUARANTINED' ? 'warning'
                  : 'danger'
                }>{u.availability}</Badge>
                <div className="flex-1">
                  <p className="text-sm font-medium">{u.product?.title ?? u.productId}</p>
                  <p className="text-xs text-ink-400 mt-1">
                    Serial {u.serialNumber} · {u.warrantyMonths}mo warranty · {(u.priceMinor / 100).toFixed(2)} {u.currency}
                  </p>
                </div>
                {(u.availability === 'AVAILABLE' || u.availability === 'QUARANTINED') && (
                  <button onClick={() => withdraw(u.id)} className="ons-btn-ghost text-xs">Withdraw</button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
