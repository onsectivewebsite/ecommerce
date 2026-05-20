'use client';

import * as React from 'react';
import type {
  AdminDataExportRow,
  ConsentMetrics,
  DataExportStatus,
  PendingDeletionRow,
} from '@onsective/api-client';
import { api } from '@/lib/api';

const STATUS_LABEL: Record<DataExportStatus, string> = {
  PENDING: 'Queued',
  BUILDING: 'Building',
  READY: 'Ready',
  EXPIRED: 'Expired',
  FAILED: 'Failed',
};
const STATUS_TONE: Record<DataExportStatus, string> = {
  PENDING: 'text-ink-300',
  BUILDING: 'text-ink-300',
  READY: 'text-success',
  EXPIRED: 'text-ink-400',
  FAILED: 'text-danger',
};

export default function AdminPrivacyPage() {
  const [pending, setPending] = React.useState<PendingDeletionRow[] | null>(null);
  const [exports, setExports] = React.useState<AdminDataExportRow[] | null>(null);
  const [metrics, setMetrics] = React.useState<ConsentMetrics | null>(null);
  const [statusFilter, setStatusFilter] = React.useState<DataExportStatus | 'ALL'>('ALL');
  const [scanResult, setScanResult] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    try {
      const [p, e, m] = await Promise.all([
        api.privacyAdmin.pendingDeletions(),
        api.privacyAdmin.recentExports({
          limit: 100,
          status: statusFilter === 'ALL' ? undefined : statusFilter,
        }),
        api.privacyAdmin.consentMetrics().catch(() => null),
      ]);
      setPending(p);
      setExports(e);
      setMetrics(m);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [statusFilter]);

  React.useEffect(() => { void reload(); }, [reload]);

  async function runScan() {
    setBusy(true); setScanResult(null); setError(null);
    try {
      const r = await api.privacyAdmin.scanDue();
      setScanResult(`Scanned ${r.scanned} due users → anonymized ${r.anonymized}, failed ${r.failed}.`);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  }

  if (!pending || !exports) {
    return <div className="container py-10 text-ink-400">Loading…</div>;
  }

  return (
    <div className="container py-10 space-y-6">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="font-display text-3xl tracking-tight">Privacy</h1>
        <button onClick={runScan} disabled={busy} className="ons-btn-secondary">
          {busy ? 'Scanning…' : 'Run anonymize scan'}
        </button>
      </header>

      {error && <div className="ons-card border-danger/40 text-danger">{error}</div>}
      {scanResult && <div className="ons-card border-success/40 text-success">{scanResult}</div>}

      {metrics && (
        <section>
          <h2 className="font-medium mb-3">Consent ({metrics.totalRecords.toLocaleString()} records)</h2>
          <div className="ons-card p-0 overflow-x-auto">
            <table className="text-sm w-full">
              <thead className="text-ink-400 text-left">
                <tr>
                  <th className="px-3 py-2">Region</th>
                  <th className="px-3 py-2 text-right">Records</th>
                  <th className="px-3 py-2 text-right">Functional</th>
                  <th className="px-3 py-2 text-right">Analytics</th>
                  <th className="px-3 py-2 text-right">Marketing</th>
                  <th className="px-3 py-2 text-right">Marketing email</th>
                </tr>
              </thead>
              <tbody>
                {metrics.optInCounts.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-400">No consent records yet.</td></tr>
                ) : metrics.optInCounts.map((r) => {
                  const region = metrics.regions.find((x) => x.region === r.region);
                  const denom = region?.count ?? 0;
                  const pct = (n: number) => denom === 0 ? '—' : `${Math.round((n / denom) * 100)}%`;
                  return (
                    <tr key={r.region} className="border-t border-ink-800">
                      <td className="px-3 py-2">{r.region}</td>
                      <td className="px-3 py-2 text-right">{denom}</td>
                      <td className="px-3 py-2 text-right">{r.functional} <span className="text-xs text-ink-400">({pct(r.functional)})</span></td>
                      <td className="px-3 py-2 text-right">{r.analytics} <span className="text-xs text-ink-400">({pct(r.analytics)})</span></td>
                      <td className="px-3 py-2 text-right">{r.marketing} <span className="text-xs text-ink-400">({pct(r.marketing)})</span></td>
                      <td className="px-3 py-2 text-right">{r.marketingEmail} <span className="text-xs text-ink-400">({pct(r.marketingEmail)})</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {metrics.recentOptOuts.length > 0 && (
            <div className="mt-3 text-xs text-ink-400">
              Recent opt-outs via unsubscribe link: {metrics.recentOptOuts.length}, latest {new Date(metrics.recentOptOuts[0].createdAt).toLocaleString()}.
            </div>
          )}
        </section>
      )}

      <section>
        <h2 className="font-medium mb-3">Pending deletions ({pending.length})</h2>
        <div className="ons-card p-0 overflow-x-auto">
          <table className="text-sm w-full">
            <thead className="text-ink-400 text-left">
              <tr>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Requested</th>
                <th className="px-3 py-2">Scheduled for</th>
              </tr>
            </thead>
            <tbody>
              {pending.length === 0 ? (
                <tr><td colSpan={3} className="px-3 py-6 text-center text-ink-400">No deletions pending.</td></tr>
              ) : pending.map((p) => (
                <tr key={p.id} className="border-t border-ink-800">
                  <td className="px-3 py-2">
                    <div>{`${p.firstName} ${p.lastName}`.trim() || p.email}</div>
                    <div className="text-xs text-ink-400">{p.email}</div>
                  </td>
                  <td className="px-3 py-2 text-ink-300">{new Date(p.deletionRequestedAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-ink-300">{new Date(p.deletionScheduledFor).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="font-medium">Recent exports</h2>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as DataExportStatus | 'ALL')}
            className="bg-ink-900 border border-ink-800 rounded-md text-sm h-9 px-2"
          >
            <option value="ALL">All statuses</option>
            <option value="PENDING">Queued</option>
            <option value="BUILDING">Building</option>
            <option value="READY">Ready</option>
            <option value="EXPIRED">Expired</option>
            <option value="FAILED">Failed</option>
          </select>
        </div>
        <div className="ons-card p-0 overflow-x-auto">
          <table className="text-sm w-full">
            <thead className="text-ink-400 text-left">
              <tr>
                <th className="px-3 py-2">Requested</th>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Size</th>
                <th className="px-3 py-2">Expires</th>
              </tr>
            </thead>
            <tbody>
              {exports.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-400">No exports.</td></tr>
              ) : exports.map((e) => (
                <tr key={e.id} className="border-t border-ink-800">
                  <td className="px-3 py-2 text-ink-300">{new Date(e.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <div>{e.user.name || e.user.email}</div>
                    <div className="text-xs text-ink-400">{e.user.email}</div>
                  </td>
                  <td className={`px-3 py-2 ${STATUS_TONE[e.status]}`}>
                    {STATUS_LABEL[e.status]}
                    {e.error && <span className="ml-2 text-danger text-xs">{e.error}</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-ink-300">
                    {e.sizeBytes !== null ? `${(e.sizeBytes / 1024).toFixed(1)} KB` : '—'}
                  </td>
                  <td className="px-3 py-2 text-ink-400">
                    {e.expiresAt ? new Date(e.expiresAt).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
