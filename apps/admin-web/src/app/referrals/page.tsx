'use client';

import * as React from 'react';
import type {
  ReferralAbuseEvent,
  ReferralTopInviter,
} from '@onsective/api-client';
import { api } from '@/lib/api';

const REASON_LABELS: Record<ReferralAbuseEvent['reason'], string> = {
  NO_SUCH_CODE: 'No such code',
  CODE_DISABLED: 'Code disabled',
  SELF_REDEMPTION: 'Self-redemption',
  SAME_ADDRESS: 'Same address',
  SAME_IP: 'Same IP',
  LIMIT_REACHED: 'Limit reached (30d)',
  ALREADY_REDEEMED: 'Already redeemed',
};

const REASON_TONES: Record<ReferralAbuseEvent['reason'], string> = {
  NO_SUCH_CODE: 'text-ink-300',
  CODE_DISABLED: 'text-warning',
  SELF_REDEMPTION: 'text-danger',
  SAME_ADDRESS: 'text-danger',
  SAME_IP: 'text-danger',
  LIMIT_REACHED: 'text-warning',
  ALREADY_REDEEMED: 'text-ink-300',
};

export default function AdminReferralsPage() {
  const [top, setTop] = React.useState<ReferralTopInviter[] | null>(null);
  const [events, setEvents] = React.useState<ReferralAbuseEvent[] | null>(null);
  const [disableCode, setDisableCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    try {
      const [t, e] = await Promise.all([
        api.referralsAdmin.topInviters(30),
        api.referralsAdmin.abuseEvents(100),
      ]);
      setTop(t);
      setEvents(e);
    } catch (err) {
      setErr((err as Error).message);
    }
  }, []);

  React.useEffect(() => { void reload(); }, [reload]);

  async function onDisable(e: React.FormEvent) {
    e.preventDefault();
    const code = disableCode.trim().toUpperCase();
    if (!code) return;
    if (!confirm(`Disable referral code ${code}? Future captures will be rejected.`)) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      await api.referralsAdmin.disable(code);
      setMsg(`Disabled ${code}.`);
      setDisableCode('');
      await reload();
    } catch (err) {
      setErr((err as Error).message);
    } finally { setBusy(false); }
  }

  if (!top || !events) {
    return <div className="container py-10 text-ink-400">Loading…</div>;
  }

  return (
    <div className="container py-10 space-y-6">
      <h1 className="font-display text-3xl tracking-tight">Referrals</h1>

      {err && <div className="ons-card border-danger/40 text-danger">{err}</div>}
      {msg && <div className="ons-card border-success/40 text-success">{msg}</div>}

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="ons-card">
          <h2 className="font-medium mb-3">Top inviters (last 30d)</h2>
          {top.length === 0 ? (
            <p className="text-ink-400 text-sm">No redemptions in the last 30 days.</p>
          ) : (
            <table className="text-sm w-full">
              <thead className="text-ink-400 text-left">
                <tr>
                  <th className="py-1">Buyer</th>
                  <th className="py-1 text-right">Redemptions</th>
                </tr>
              </thead>
              <tbody>
                {top.map((t) => (
                  <tr key={t.userId} className="border-t border-ink-800">
                    <td className="py-2">
                      <div>{t.name || t.email}</div>
                      <div className="text-xs text-ink-400">{t.email}</div>
                    </td>
                    <td className="py-2 text-right">{t.redemptions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="ons-card">
          <h2 className="font-medium mb-3">Disable a code</h2>
          <form onSubmit={onDisable} className="flex gap-2">
            <input
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value.toUpperCase())}
              placeholder="ABCDEFGH"
              maxLength={32}
              className="ons-input flex-1 font-mono"
            />
            <button type="submit" disabled={busy} className="ons-btn-secondary">
              {busy ? 'Working…' : 'Disable'}
            </button>
          </form>
          <p className="text-xs text-ink-400 mt-2">
            Disabled codes still resolve to the inviter for the abuse log, but write no redemption and no points.
          </p>
        </div>
      </div>

      <div>
        <h2 className="font-medium mb-3">Recent rejections</h2>
        <div className="ons-card p-0 overflow-x-auto">
          <table className="text-sm w-full">
            <thead className="text-ink-400 text-left">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">IP</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-400">No rejections.</td></tr>
              ) : events.map((e) => (
                <tr key={e.id} className="border-t border-ink-800">
                  <td className="px-3 py-2 text-ink-300">{new Date(e.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2 font-mono">{e.attemptedCode}</td>
                  <td className={`px-3 py-2 ${REASON_TONES[e.reason]}`}>{REASON_LABELS[e.reason]}</td>
                  <td className="px-3 py-2 text-ink-300">{e.attemptedUserId ?? '—'}</td>
                  <td className="px-3 py-2 text-ink-400 font-mono">{e.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
