'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type {
  RepairPartnerRow,
  ServiceTicketRow,
} from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function AdminRepairNetworkPage() {
  const { user, loading } = useAuth();
  const [partners, setPartners] = React.useState<RepairPartnerRow[] | null>(null);
  const [unassigned, setUnassigned] = React.useState<ServiceTicketRow[]>([]);
  const [recent, setRecent] = React.useState<ServiceTicketRow[]>([]);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  // New-partner form
  const [pUserId, setPUserId] = React.useState('');
  const [pName, setPName] = React.useState('');
  const [pCaps, setPCaps] = React.useState('phones,laptops');
  const [pCap, setPCap] = React.useState(20);
  const [pHours, setPHours] = React.useState(72);
  const [pCountry, setPCountry] = React.useState('US');

  // Assignment selectors
  const [assignFor, setAssignFor] = React.useState<string | null>(null);
  const [assignTo, setAssignTo] = React.useState('');

  const load = React.useCallback(async () => {
    const [p, u, r] = await Promise.all([
      api.repairNetwork.adminListPartners().catch(() => []),
      api.repairNetwork.adminUnassignedTickets().catch(() => []),
      api.repairNetwork.adminListTickets(50).catch(() => []),
    ]);
    setPartners(p); setUnassigned(u); setRecent(r);
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function createPartner() {
    setBusy('create'); setErr(null);
    try {
      await api.repairNetwork.adminCreatePartner({
        userId: pUserId,
        displayName: pName,
        capabilityCategorySlugs: pCaps.split(',').map((s) => s.trim()).filter(Boolean),
        dailyCapacity: pCap,
        turnaroundHours: pHours,
        serviceCountry: pCountry,
      });
      setPUserId(''); setPName('');
      load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  async function togglePartnerStatus(p: RepairPartnerRow) {
    setBusy(p.id);
    try {
      await api.repairNetwork.adminUpdatePartner(p.id, {
        status: p.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE',
      });
      load();
    } finally { setBusy(null); }
  }

  async function assign(ticketId: string) {
    if (!assignTo) return;
    setBusy(ticketId);
    try {
      await api.repairNetwork.adminAssignTicket(ticketId, assignTo);
      setAssignFor(null); setAssignTo('');
      load();
    } finally { setBusy(null); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!partners) return <div className="container py-16 text-ink-400">Loading repair network…</div>;

  return (
    <div className="container py-10 space-y-10">
      <header>
        <h1 className="font-display text-3xl tracking-tight">Repair network</h1>
        <p className="text-sm text-ink-400 mt-1">
          Verified repair partners and the warranty-driven service tickets routed to them.
        </p>
      </header>

      <section>
        <h2 className="font-medium mb-3">Register a partner</h2>
        <div className="ons-card space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <input value={pUserId} onChange={(e) => setPUserId(e.target.value)} placeholder="User ID (partner login)" className="ons-input" />
            <input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Display name" className="ons-input" />
            <input value={pCaps} onChange={(e) => setPCaps(e.target.value)} placeholder="Capability category slugs (comma-separated)" className="ons-input" />
            <input value={pCountry} onChange={(e) => setPCountry(e.target.value.toUpperCase())} maxLength={2} placeholder="Service country (ISO-2)" className="ons-input" />
            <input type="number" value={pCap} onChange={(e) => setPCap(Number(e.target.value))} placeholder="Daily capacity" className="ons-input" />
            <input type="number" value={pHours} onChange={(e) => setPHours(Number(e.target.value))} placeholder="Turnaround hours" className="ons-input" />
          </div>
          {err && <div className="text-danger text-sm">{err}</div>}
          <button disabled={busy === 'create' || !pUserId || !pName} onClick={createPartner} className="ons-btn-primary">
            {busy === 'create' ? 'Creating…' : 'Register partner'}
          </button>
        </div>
      </section>

      <section>
        <h2 className="font-medium mb-3">Partners</h2>
        {partners.length === 0 ? <p className="text-ink-400">No partners registered.</p> : (
          <div className="space-y-2">
            {partners.map((p) => (
              <div key={p.id} className="ons-card flex items-center gap-3">
                <Badge tone={p.status === 'ACTIVE' ? 'success' : p.status === 'PENDING' ? 'warning' : 'neutral'}>{p.status}</Badge>
                <div className="flex-1">
                  <p className="font-medium text-sm">{p.displayName}</p>
                  <p className="text-xs text-ink-400 mt-1">
                    {p.capabilityCategorySlugs.join(', ') || '(no capabilities set)'}
                    {' · '}cap {p.dailyCapacity}/day
                    {' · '}{p.turnaroundHours}h SLA
                    {p.serviceCountry && ` · ${p.serviceCountry}`}
                    {p._count?.tickets != null && ` · ${p._count.tickets} ticket(s)`}
                  </p>
                </div>
                <button disabled={busy === p.id} onClick={() => togglePartnerStatus(p)} className="ons-btn-ghost text-xs">
                  {p.status === 'ACTIVE' ? 'Pause' : 'Activate'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-medium mb-3">Unassigned tickets ({unassigned.length})</h2>
        {unassigned.length === 0 ? <p className="text-ink-400">All caught up.</p> : (
          <div className="space-y-2">
            {unassigned.map((t) => (
              <div key={t.id} className="ons-card">
                <div className="flex items-center gap-3 flex-wrap">
                  <Badge tone="warning">{t.status}</Badge>
                  <div className="flex-1 min-w-[200px]">
                    <p className="font-medium text-sm">{t.warrantyClaim?.orderItem?.productTitleSnapshot ?? 'Ticket'}</p>
                    <p className="text-xs text-ink-400 mt-1">{t.warrantyClaim?.symptom}</p>
                  </div>
                  <button onClick={() => { const same = assignFor === t.id; setAssignFor(same ? null : t.id); setAssignTo(''); }} className="ons-btn-ghost text-xs">
                    {assignFor === t.id ? 'Close' : 'Assign'}
                  </button>
                </div>
                {assignFor === t.id && (
                  <div className="mt-3 border-t border-ink-800 pt-3 grid sm:grid-cols-2 gap-2">
                    <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className="ons-input">
                      <option value="">Pick partner…</option>
                      {partners.filter((p) => p.status === 'ACTIVE').map((p) => (
                        <option key={p.id} value={p.id}>{p.displayName} ({p.capabilityCategorySlugs.join(', ')})</option>
                      ))}
                    </select>
                    <button disabled={busy === t.id || !assignTo} onClick={() => assign(t.id)} className="ons-btn-primary text-sm">
                      Assign partner
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-medium mb-3">Recent tickets</h2>
        <div className="space-y-1">
          {recent.map((t) => (
            <div key={t.id} className="ons-card flex items-center gap-3 text-xs">
              <Badge tone={
                t.status === 'COMPLETED' ? 'success'
                : t.status === 'CANCELLED' ? 'danger'
                : 'warning'
              }>{t.status}</Badge>
              <code className="text-ink-400">{t.id.slice(-10)}</code>
              <span className="text-ink-300 flex-1 truncate">{t.warrantyClaim?.orderItem?.productTitleSnapshot ?? '—'}</span>
              <span className="text-ink-400">{t.partner?.displayName ?? 'unassigned'}</span>
              <span className="text-ink-500">{new Date(t.updatedAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
