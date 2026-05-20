'use client';

import * as React from 'react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function AdminWalletGrantPage() {
  const { user, loading } = useAuth();
  const [targetUserId, setTargetUserId] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [currency, setCurrency] = React.useState('USD');
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ newBalance: number } | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;

  async function grant() {
    setBusy(true); setErr(null);
    try {
      const r = await api.wallet.adminGrant({
        targetUserId,
        amountMinor: Math.round(Number(amount) * 100),
        currency,
        reason,
      });
      setResult(r);
      setAmount(''); setReason('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container py-10 max-w-2xl">
      <h1 className="font-display text-3xl tracking-tight mb-6">Wallet grants</h1>
      <div className="ons-card space-y-3">
        <p className="text-sm text-ink-400">
          Credit a buyer's wallet. Use for makegoods, signup bonuses, or compensation. Every grant is logged
          in the audit trail with your admin ID.
        </p>
        <input value={targetUserId} onChange={(e) => setTargetUserId(e.target.value)} placeholder="Target user ID (ULID)" className="ons-input w-full" />
        <div className="grid grid-cols-3 gap-3">
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" type="number" step="0.01" min="0" className="ons-input col-span-2" />
          <input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} placeholder="USD" maxLength={3} className="ons-input" />
        </div>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (logged)" className="ons-input w-full" />
        {err && <div className="text-danger text-sm">{err}</div>}
        {result && <div className="text-success text-sm">Granted. New balance: ${(result.newBalance / 100).toFixed(2)}</div>}
        <button disabled={busy || !targetUserId || !amount || !reason} onClick={grant} className="ons-btn-primary">
          {busy ? 'Granting…' : 'Issue credit'}
        </button>
      </div>
    </div>
  );
}
