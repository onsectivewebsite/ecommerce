'use client';

import * as React from 'react';
import type { GiftCardRow, GiftCardStatus } from '@onsective/api-client';
import { api } from '@/lib/api';

const STATUSES: Array<GiftCardStatus | 'ALL'> = [
  'ALL',
  'PENDING_PAYMENT',
  'ACTIVE',
  'REDEEMED',
  'VOID',
  'EXPIRED',
];

function money(minor: number, currency: string) {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

export default function AdminGiftCardsPage() {
  const [rows, setRows] = React.useState<GiftCardRow[] | null>(null);
  const [status, setStatus] = React.useState<GiftCardStatus | 'ALL'>('ALL');
  const [q, setQ] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const reload = React.useCallback(async () => {
    try {
      setRows(
        await api.giftCards.list({
          status: status === 'ALL' ? undefined : status,
          q: q.trim() || undefined,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }, [status, q]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  async function onIssue(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    try {
      const dollars = parseFloat(String(fd.get('amount')));
      const card = await api.giftCards.issue({
        amountMinor: Math.round(dollars * 100),
        recipientEmail: String(fd.get('recipientEmail')),
        recipientName: String(fd.get('recipientName') || '') || undefined,
        message: String(fd.get('message') || '') || undefined,
        expiresAt: String(fd.get('expiresAt') || '') || undefined,
      });
      setMsg(`Issued promo card ${card.code} for ${money(card.initialAmountMinor, card.currency)}.`);
      e.currentTarget.reset();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onVoid(id: string) {
    if (!confirm('Void this gift card? It can no longer be redeemed.')) return;
    setBusy(true);
    setError(null);
    try {
      await api.giftCards.void(id);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container py-10 space-y-6">
      <h1 className="font-display text-3xl tracking-tight">Gift cards</h1>

      {error && <div className="ons-card border-danger/40 text-danger">{error}</div>}
      {msg && <div className="ons-card border-success/40 text-success">{msg}</div>}

      <section className="ons-card">
        <h2 className="font-medium mb-3">Issue a promotional card</h2>
        <p className="text-sm text-ink-400 mb-4">
          Creates an active card with no payment. The recipient is emailed the code immediately.
        </p>
        <form onSubmit={onIssue} className="grid grid-cols-2 gap-3 max-w-xl">
          <label className="text-sm">
            <span className="text-ink-300">Amount (USD)</span>
            <input name="amount" type="number" min={5} max={1000} step={1} required
              className="mt-1 w-full bg-ink-900 border border-ink-800 rounded-md h-9 px-2" />
          </label>
          <label className="text-sm">
            <span className="text-ink-300">Recipient email</span>
            <input name="recipientEmail" type="email" required
              className="mt-1 w-full bg-ink-900 border border-ink-800 rounded-md h-9 px-2" />
          </label>
          <label className="text-sm">
            <span className="text-ink-300">Recipient name (optional)</span>
            <input name="recipientName"
              className="mt-1 w-full bg-ink-900 border border-ink-800 rounded-md h-9 px-2" />
          </label>
          <label className="text-sm">
            <span className="text-ink-300">Expires (optional)</span>
            <input name="expiresAt" type="date"
              className="mt-1 w-full bg-ink-900 border border-ink-800 rounded-md h-9 px-2" />
          </label>
          <label className="text-sm col-span-2">
            <span className="text-ink-300">Message (optional)</span>
            <input name="message" maxLength={500}
              className="mt-1 w-full bg-ink-900 border border-ink-800 rounded-md h-9 px-2" />
          </label>
          <div className="col-span-2">
            <button type="submit" disabled={busy} className="ons-btn-primary">
              {busy ? 'Issuing…' : 'Issue card'}
            </button>
          </div>
        </form>
      </section>

      <section>
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <h2 className="font-medium">All gift cards</h2>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as GiftCardStatus | 'ALL')}
            className="bg-ink-900 border border-ink-800 rounded-md text-sm h-9 px-2"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s === 'ALL' ? 'All statuses' : s}</option>
            ))}
          </select>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search code or recipient…"
            className="bg-ink-900 border border-ink-800 rounded-md text-sm h-9 px-2 flex-1 min-w-[200px]"
          />
        </div>
        <div className="ons-card p-0 overflow-x-auto">
          <table className="text-sm w-full">
            <thead className="text-ink-400 text-left">
              <tr>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Initial</th>
                <th className="px-3 py-2 text-right">Balance</th>
                <th className="px-3 py-2">Recipient</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {!rows ? (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-400">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-400">No gift cards.</td></tr>
              ) : rows.map((c) => (
                <tr key={c.id} className="border-t border-ink-800">
                  <td className="px-3 py-2 font-mono text-xs">{c.code}</td>
                  <td className="px-3 py-2">{c.status.replace('_', ' ')}</td>
                  <td className="px-3 py-2 text-right">{money(c.initialAmountMinor, c.currency)}</td>
                  <td className="px-3 py-2 text-right">{money(c.balanceMinor, c.currency)}</td>
                  <td className="px-3 py-2 text-ink-300">{c.recipientEmail}</td>
                  <td className="px-3 py-2 text-ink-400">{new Date(c.createdAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2">
                    {(c.status === 'ACTIVE' || c.status === 'PENDING_PAYMENT') && (
                      <button onClick={() => onVoid(c.id)} disabled={busy}
                        className="text-danger hover:underline text-xs">
                        Void
                      </button>
                    )}
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
