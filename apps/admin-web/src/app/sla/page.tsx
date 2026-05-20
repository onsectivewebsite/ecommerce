'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type { SlaBreachRow, SlaProfileRow } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function AdminSlaPage() {
  const { user, loading } = useAuth();
  const [profiles, setProfiles] = React.useState<SlaProfileRow[] | null>(null);
  const [breaches, setBreaches] = React.useState<SlaBreachRow[]>([]);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const [warehouseId, setWarehouseId] = React.useState('');
  const [country, setCountry] = React.useState('US');
  const [region, setRegion] = React.useState('');
  const [shipDays, setShipDays] = React.useState(1);
  const [deliveryDays, setDeliveryDays] = React.useState(3);
  const [notes, setNotes] = React.useState('');

  const load = React.useCallback(async () => {
    const [p, b] = await Promise.all([
      api.sla.adminListProfiles().catch(() => []),
      api.sla.adminBreaches(100).catch(() => []),
    ]);
    setProfiles(p); setBreaches(b);
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function save() {
    setBusy(true); setErr(null);
    try {
      await api.sla.adminUpsertProfile({
        warehouseId, country, region: region || undefined,
        shipDays, deliveryDays, notes: notes || undefined,
      });
      setNotes('');
      load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  async function del(id: string) {
    if (!confirm('Delete this SLA profile?')) return;
    setBusy(true);
    try { await api.sla.adminDeleteProfile(id); load(); }
    finally { setBusy(false); }
  }

  async function runScan() {
    setBusy(true);
    try {
      const r = await api.sla.adminScan();
      alert(`Scanned: SHIP=${r.shipBreaches}, DELIVER=${r.deliverBreaches}`);
      load();
    } finally { setBusy(false); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!profiles) return <div className="container py-16 text-ink-400">Loading SLA…</div>;

  return (
    <div className="container py-10 space-y-10">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl tracking-tight">SLA</h1>
          <p className="text-sm text-ink-400 mt-1">
            Per-warehouse shipping & delivery windows. Per-item routing
            snapshots one of these onto each OrderItem at checkout. Future
            edits don't retroactively change existing promises.
          </p>
        </div>
        <button onClick={runScan} disabled={busy} className="ons-btn-ghost text-sm">Run breach scan</button>
      </header>

      {err && <div className="text-danger text-sm">{err}</div>}

      <section>
        <h2 className="font-medium mb-3">Upsert profile</h2>
        <div className="ons-card space-y-3">
          <div className="grid sm:grid-cols-3 gap-3">
            <input value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} placeholder="Warehouse ID" className="ons-input" />
            <input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={2} placeholder="Country (ISO-2)" className="ons-input" />
            <input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="Region (optional)" className="ons-input" />
            <input type="number" min={0} value={shipDays} onChange={(e) => setShipDays(Number(e.target.value))} placeholder="Ship days" className="ons-input" />
            <input type="number" min={0} value={deliveryDays} onChange={(e) => setDeliveryDays(Number(e.target.value))} placeholder="Delivery days" className="ons-input" />
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" className="ons-input" />
          </div>
          <button disabled={busy || !warehouseId || !country} onClick={save} className="ons-btn-primary">
            {busy ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </section>

      <section>
        <h2 className="font-medium mb-3">Profiles ({profiles.length})</h2>
        {profiles.length === 0 ? <p className="text-ink-400">No profiles yet.</p> : (
          <div className="space-y-1">
            {profiles.map((p) => (
              <div key={p.id} className="ons-card flex items-center gap-3 text-sm">
                <code className="text-xs text-ink-400 w-32 truncate">
                  {p.warehouse?.code ?? p.warehouseId.slice(-6)}
                </code>
                <Badge tone="neutral">{p.country}{p.region ? `:${p.region}` : ''}</Badge>
                <span className="flex-1 text-xs text-ink-300">
                  ship {p.shipDays}d · deliver {p.deliveryDays}d
                  {p.notes && ` · ${p.notes}`}
                </span>
                <button onClick={() => del(p.id)} className="ons-btn-ghost text-xs">Delete</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-medium mb-3">Recent breaches ({breaches.length})</h2>
        {breaches.length === 0 ? <p className="text-ink-400">No breaches recorded — nice.</p> : (
          <div className="space-y-1">
            {breaches.map((b) => (
              <div key={b.id} className="ons-card flex items-center gap-3 text-xs">
                <Badge tone="danger">{b.kind}</Badge>
                <code className="text-ink-400">{b.orderItemId.slice(-10)}</code>
                <span className="flex-1 text-ink-300 truncate">{b.orderItem?.productTitleSnapshot ?? '—'}</span>
                <span className="text-ink-400">{b.breachHours.toFixed(1)}h late</span>
                <span className="text-ink-500">{new Date(b.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
