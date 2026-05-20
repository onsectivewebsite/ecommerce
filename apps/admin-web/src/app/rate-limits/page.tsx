'use client';

import * as React from 'react';
import type {
  AbuseEventKind,
  AbuseEventRow,
  RateLimitBlockRow,
} from '@onsective/api-client';
import { api } from '@/lib/api';

const KIND_LABEL: Record<AbuseEventKind, string> = {
  RATE_LIMIT_EXCEEDED: 'Limit exceeded',
  REPEAT_VIOLATION: 'Repeat violation',
  MANUAL_BLOCK: 'Manual block',
};

const KIND_TONE: Record<AbuseEventKind, string> = {
  RATE_LIMIT_EXCEEDED: 'text-warning',
  REPEAT_VIOLATION: 'text-danger',
  MANUAL_BLOCK: 'text-ink-300',
};

export default function AdminRateLimitsPage() {
  const [events, setEvents] = React.useState<AbuseEventRow[] | null>(null);
  const [blocks, setBlocks] = React.useState<RateLimitBlockRow[] | null>(null);
  const [ruleFilter, setRuleFilter] = React.useState('');
  const [activeOnly, setActiveOnly] = React.useState(true);
  const [manualKey, setManualKey] = React.useState('');
  const [manualRule, setManualRule] = React.useState('');
  const [manualReason, setManualReason] = React.useState('');
  const [manualUntil, setManualUntil] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    try {
      const [e, b] = await Promise.all([
        api.rateLimits.events({ ruleId: ruleFilter || undefined, limit: 200 }),
        api.rateLimits.blocks(activeOnly),
      ]);
      setEvents(e);
      setBlocks(b);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [ruleFilter, activeOnly]);

  React.useEffect(() => { void reload(); }, [reload]);

  async function block() {
    if (!manualKey || !manualRule || !manualReason) {
      setError('Key, ruleId, and reason are required.');
      return;
    }
    setBusy(true); setError(null); setMsg(null);
    try {
      await api.rateLimits.block({
        key: manualKey,
        ruleId: manualRule,
        reason: manualReason,
        blockedUntil: manualUntil ? new Date(manualUntil).toISOString() : undefined,
      });
      setMsg(`Blocked ${manualKey}.`);
      setManualKey(''); setManualReason(''); setManualUntil('');
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  }

  async function unblock(key: string) {
    if (!confirm(`Remove block on ${key}?`)) return;
    setBusy(true); setError(null); setMsg(null);
    try {
      await api.rateLimits.unblock(key);
      setMsg(`Unblocked ${key}.`);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  }

  if (!events || !blocks) {
    return <div className="container py-10 text-ink-400">Loading…</div>;
  }

  return (
    <div className="container py-10 space-y-6">
      <h1 className="font-display text-3xl tracking-tight">Rate limits</h1>

      {error && <div className="ons-card border-danger/40 text-danger">{error}</div>}
      {msg && <div className="ons-card border-success/40 text-success">{msg}</div>}

      <section>
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <h2 className="font-medium">Active blocks ({blocks.length})</h2>
          <label className="text-xs text-ink-300 flex items-center gap-1">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.target.checked)}
            />
            Active only
          </label>
        </div>
        <div className="ons-card p-0 overflow-x-auto">
          <table className="text-sm w-full">
            <thead className="text-ink-400 text-left">
              <tr>
                <th className="px-3 py-2">Key</th>
                <th className="px-3 py-2">Rule</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Blocked until</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {blocks.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-400">No blocks.</td></tr>
              ) : blocks.map((b) => (
                <tr key={b.id} className="border-t border-ink-800">
                  <td className="px-3 py-2 font-mono text-xs">{b.key}</td>
                  <td className="px-3 py-2 text-ink-300">{b.ruleId}</td>
                  <td className="px-3 py-2 text-ink-300">{b.source}</td>
                  <td className="px-3 py-2 text-ink-300">
                    {b.blockedUntil ? new Date(b.blockedUntil).toLocaleString() : 'Indefinite'}
                  </td>
                  <td className="px-3 py-2 text-ink-400 text-xs">{b.reason}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => unblock(b.key)} disabled={busy} className="ons-btn-ghost text-xs text-danger">
                      Unblock
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="font-medium mb-3">Add manual block</h2>
        <div className="ons-card grid sm:grid-cols-2 gap-3 text-sm">
          <label>
            <div className="text-xs text-ink-400 mb-1">Key (e.g., auth.login:ip:203.0.113.42)</div>
            <input value={manualKey} onChange={(e) => setManualKey(e.target.value)} className="ons-input font-mono" />
          </label>
          <label>
            <div className="text-xs text-ink-400 mb-1">Rule id (e.g., auth.login)</div>
            <input value={manualRule} onChange={(e) => setManualRule(e.target.value)} className="ons-input" />
          </label>
          <label className="sm:col-span-2">
            <div className="text-xs text-ink-400 mb-1">Reason</div>
            <input value={manualReason} onChange={(e) => setManualReason(e.target.value)} className="ons-input" />
          </label>
          <label>
            <div className="text-xs text-ink-400 mb-1">Blocked until (optional; leave blank for indefinite)</div>
            <input type="datetime-local" value={manualUntil} onChange={(e) => setManualUntil(e.target.value)} className="ons-input" />
          </label>
          <div className="flex items-end">
            <button onClick={block} disabled={busy} className="ons-btn-primary w-full">
              {busy ? 'Working…' : 'Apply block'}
            </button>
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h2 className="font-medium">Recent abuse events ({events.length})</h2>
          <input
            value={ruleFilter}
            onChange={(e) => setRuleFilter(e.target.value)}
            placeholder="Filter by rule id"
            className="ons-input text-sm w-48"
          />
        </div>
        <div className="ons-card p-0 overflow-x-auto">
          <table className="text-sm w-full">
            <thead className="text-ink-400 text-left">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Rule</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Key</th>
                <th className="px-3 py-2">IP</th>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Path</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-400">No events.</td></tr>
              ) : events.map((e) => (
                <tr key={e.id} className="border-t border-ink-800">
                  <td className="px-3 py-2 text-ink-300">{new Date(e.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-ink-300">{e.ruleId}</td>
                  <td className={`px-3 py-2 ${KIND_TONE[e.kind]}`}>{KIND_LABEL[e.kind]}</td>
                  <td className="px-3 py-2 font-mono text-xs">{e.key}</td>
                  <td className="px-3 py-2 text-ink-400 font-mono">{e.ip ?? '—'}</td>
                  <td className="px-3 py-2 text-ink-400 font-mono text-xs">{e.userId ?? '—'}</td>
                  <td className="px-3 py-2 text-ink-400 font-mono text-xs">{e.requestPath ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
