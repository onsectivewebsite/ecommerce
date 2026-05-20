'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type { WarehouseRow } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function AdminWarehousesPage() {
  const { user, loading } = useAuth();
  const [rows, setRows] = React.useState<WarehouseRow[] | null>(null);
  const [showCreate, setShowCreate] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const [code, setCode] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [line1, setLine1] = React.useState('');
  const [city, setCity] = React.useState('');
  const [region, setRegion] = React.useState('');
  const [postalCode, setPostalCode] = React.useState('');
  const [country, setCountry] = React.useState('US');
  const [zoneCountries, setZoneCountries] = React.useState('US');

  const load = React.useCallback(() => {
    api.warehouses.adminList().then(setRows).catch(() => setRows([]));
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function create() {
    setCreating(true); setErr(null);
    try {
      const zones = zoneCountries.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean).map((c) => ({ country: c }));
      await api.warehouses.adminCreate({
        code, displayName, line1, city, region, postalCode, country: country.toUpperCase(),
        zones,
      });
      setShowCreate(false); setCode(''); setDisplayName(''); setLine1(''); setCity(''); setRegion(''); setPostalCode('');
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally { setCreating(false); }
  }

  async function toggle(w: WarehouseRow) {
    await api.warehouses.adminUpdate(w.id, { status: w.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' });
    load();
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!rows) return <div className="container py-16 text-ink-400">Loading warehouses…</div>;

  return (
    <div className="container py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-3xl tracking-tight">Warehouses</h1>
        <button onClick={() => setShowCreate((v) => !v)} className="ons-btn-primary text-sm">
          {showCreate ? 'Cancel' : '+ New warehouse'}
        </button>
      </div>

      {showCreate && (
        <div className="ons-card mb-6 space-y-3">
          <h2 className="font-medium">New warehouse</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Code (e.g. WHX-NJ-01)" className="ons-input" />
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display name" className="ons-input" />
            <input value={line1} onChange={(e) => setLine1(e.target.value)} placeholder="Address line 1" className="ons-input sm:col-span-2" />
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" className="ons-input" />
            <input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="State / Region" className="ons-input" />
            <input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} placeholder="Postal code" className="ons-input" />
            <input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} placeholder="Country (ISO-2)" maxLength={2} className="ons-input" />
            <input value={zoneCountries} onChange={(e) => setZoneCountries(e.target.value.toUpperCase())} placeholder="Coverage countries (comma-separated)" className="ons-input sm:col-span-2" />
          </div>
          {err && <div className="text-danger text-sm">{err}</div>}
          <button disabled={creating || !code || !displayName} onClick={create} className="ons-btn-primary">
            {creating ? 'Creating…' : 'Create warehouse'}
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-ink-400">No warehouses yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((w) => (
            <div key={w.id} className="ons-card flex items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <code className="text-sm font-mono">{w.code}</code>
                  <span className="font-medium">{w.displayName}</span>
                </div>
                <div className="text-xs text-ink-400 mt-1">
                  {w.city}, {w.region} {w.postalCode}, {w.country}
                  {w._count?.stocks != null && ` · ${w._count.stocks} SKUs stocked`}
                </div>
                {w.zones.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {w.zones.map((z) => (
                      <code key={z.id} className="text-[10px] bg-ink-800 px-1.5 py-0.5 rounded">
                        {z.country}{z.regions.length > 0 ? `:${z.regions.join(',')}` : ''}
                      </code>
                    ))}
                  </div>
                )}
              </div>
              <Badge tone={w.status === 'ACTIVE' ? 'success' : w.status === 'PAUSED' ? 'warning' : 'neutral'}>
                {w.status}
              </Badge>
              <button onClick={() => toggle(w)} className="ons-btn-ghost text-sm">
                {w.status === 'ACTIVE' ? 'Pause' : 'Activate'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
