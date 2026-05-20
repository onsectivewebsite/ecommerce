'use client';

import * as React from 'react';
import { Money } from '@onsective/ui';
import type {
  AdminPlusStats,
  AdminPlusBillingEvent,
  AdminBillingEventKind,
} from '@onsective/api-client';
import { api } from '@/lib/api';

const KIND_LABELS: Record<AdminBillingEventKind, string> = {
  INVOICE_PAID: 'Invoice paid',
  INVOICE_FAILED: 'Invoice failed',
  SUB_UPDATED: 'Subscription updated',
  SUB_DELETED: 'Subscription deleted',
  NOTICE_SENT: 'Reminder sent',
};

const KIND_TONES: Record<AdminBillingEventKind, string> = {
  INVOICE_PAID: 'text-success',
  INVOICE_FAILED: 'text-danger',
  SUB_UPDATED: 'text-ink-300',
  SUB_DELETED: 'text-ink-300',
  NOTICE_SENT: 'text-ink-400',
};

export default function AdminPlusPage() {
  const [stats, setStats] = React.useState<AdminPlusStats | null>(null);
  const [events, setEvents] = React.useState<AdminPlusBillingEvent[] | null>(null);
  const [filter, setFilter] = React.useState<AdminBillingEventKind | 'ALL'>('ALL');
  const [scanResult, setScanResult] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const reload = React.useCallback(async () => {
    try {
      const [s, e] = await Promise.all([
        api.plusAdmin.stats(),
        api.plusAdmin.events({ limit: 100, kind: filter === 'ALL' ? undefined : filter }),
      ]);
      setStats(s);
      setEvents(e);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [filter]);

  React.useEffect(() => { void reload(); }, [reload]);

  async function runScan() {
    setBusy(true); setScanResult(null); setError(null);
    try {
      const r = await api.plusAdmin.scanExpiring();
      setScanResult(`Scanned ${r.scanned} memberships → emailed ${r.emailed}, skipped ${r.skippedAlreadySent} (already notified this term).`);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  }

  if (!stats || !events) {
    return <div className="container py-10 text-ink-400">Loading…</div>;
  }

  return (
    <div className="container py-10 space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Onsective Plus</h1>
          <p className="text-xs text-ink-400 mt-1">As of {new Date(stats.asOf).toLocaleString()}</p>
        </div>
        <button onClick={runScan} disabled={busy} className="ons-btn-secondary">
          {busy ? 'Scanning…' : 'Scan expiring soon'}
        </button>
      </header>

      {error && <div className="ons-card border-danger/40 text-danger">{error}</div>}
      {scanResult && <div className="ons-card border-success/40 text-success">{scanResult}</div>}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Active members" value={stats.activeCount.toLocaleString()} />
        <Kpi label="Paused (payment failed)" value={stats.pausedCount.toLocaleString()} />
        <Kpi label="MRR (estimated)" value={<Money amountMinor={stats.mrrMinor} currency="USD" emphasized />} />
        <Kpi
          label="New / Churned (30d)"
          value={
            <>
              <span className="text-success">+{stats.newLast30dByPlan.PLUS_ANNUAL + stats.newLast30dByPlan.PLUS_MONTHLY}</span>
              {' / '}
              <span className="text-danger">-{stats.churnedLast30dByPlan.PLUS_ANNUAL + stats.churnedLast30dByPlan.PLUS_MONTHLY}</span>
            </>
          }
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="ons-card">
          <h2 className="font-medium mb-2">Last 30 days by plan</h2>
          <table className="text-sm w-full">
            <thead>
              <tr className="text-ink-400 text-left">
                <th className="py-1">Plan</th>
                <th className="py-1">New</th>
                <th className="py-1">Churned</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-ink-800">
                <td className="py-1.5">Annual</td>
                <td>{stats.newLast30dByPlan.PLUS_ANNUAL}</td>
                <td>{stats.churnedLast30dByPlan.PLUS_ANNUAL}</td>
              </tr>
              <tr className="border-t border-ink-800">
                <td className="py-1.5">Monthly</td>
                <td>{stats.newLast30dByPlan.PLUS_MONTHLY}</td>
                <td>{stats.churnedLast30dByPlan.PLUS_MONTHLY}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="ons-card text-sm text-ink-300">
          <h2 className="font-medium mb-2 text-ink-100">Notes</h2>
          <ul className="list-disc list-inside space-y-1">
            <li>MRR converts annual subscriptions to a monthly equivalent (price ÷ 12).</li>
            <li>Churn counts EXPIRED/CANCELLED rows with a cancellation stamp in the last 30 days.</li>
            <li>Paused members are kept (no benefits) until they update their card or the term ends.</li>
            <li>Expiring-soon emails fire once per term; safe to re-run the scan.</li>
          </ul>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="font-medium">Recent billing events</h2>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as AdminBillingEventKind | 'ALL')}
            className="bg-ink-900 border border-ink-800 rounded-md text-sm h-9 px-2"
          >
            <option value="ALL">All events</option>
            <option value="INVOICE_PAID">Invoice paid</option>
            <option value="INVOICE_FAILED">Invoice failed</option>
            <option value="SUB_UPDATED">Subscription updated</option>
            <option value="SUB_DELETED">Subscription deleted</option>
            <option value="NOTICE_SENT">Reminder sent</option>
          </select>
        </div>
        <div className="ons-card p-0 overflow-x-auto">
          <table className="text-sm w-full">
            <thead className="text-ink-400 text-left">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Plan</th>
                <th className="px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-400">No events.</td></tr>
              ) : events.map((e) => (
                <tr key={e.id} className="border-t border-ink-800">
                  <td className="px-3 py-2 text-ink-300">{new Date(e.createdAt).toLocaleString()}</td>
                  <td className={`px-3 py-2 ${KIND_TONES[e.kind]}`}>{KIND_LABELS[e.kind]}</td>
                  <td className="px-3 py-2">
                    <div>{e.membership.userName || e.membership.userEmail}</div>
                    <div className="text-xs text-ink-400">{e.membership.userEmail}</div>
                  </td>
                  <td className="px-3 py-2 text-ink-300">{e.membership.plan === 'PLUS_ANNUAL' ? 'Annual' : 'Monthly'}</td>
                  <td className="px-3 py-2 text-right">
                    {typeof e.amountMinor === 'number' && e.currency
                      ? <Money amountMinor={e.amountMinor} currency={e.currency} />
                      : <span className="text-ink-500">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="ons-card">
      <div className="text-xs uppercase tracking-[0.18em] text-ink-400">{label}</div>
      <div className="text-2xl font-display mt-1">{value}</div>
    </div>
  );
}
