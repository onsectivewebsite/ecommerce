'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type { SerialLookupResult } from '@onsective/api-client';
import { api } from '@/lib/api';

export default function VerifyPage() {
  const [serial, setSerial] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<SerialLookupResult | null | undefined>(undefined);
  const [err, setErr] = React.useState<string | null>(null);

  async function lookup(e?: React.FormEvent) {
    e?.preventDefault();
    if (!serial.trim()) return;
    setBusy(true); setErr(null); setResult(undefined);
    try {
      const r = await api.refurbUnits.lookupSerial(serial.trim());
      setResult(r);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="container py-16 max-w-2xl">
      <h1 className="font-display text-3xl tracking-tight">Verify authenticity</h1>
      <p className="text-sm text-ink-400 mt-2 mb-6">
        Every Onsective unit ships with a verifiable serial. Enter the serial number from
        your packaging or device to see the authentication trail.
      </p>
      <form onSubmit={lookup} className="flex gap-2 mb-6">
        <input value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="Serial number"
               className="ons-input flex-1" />
        <button disabled={busy} className="ons-btn-primary">{busy ? 'Looking up…' : 'Verify'}</button>
      </form>
      {err && <div className="text-danger text-sm">{err}</div>}
      {result === null && (
        <div className="ons-card text-sm text-ink-300">
          No record found for that serial. If you bought this on Onsective, please contact support.
        </div>
      )}
      {result && (
        <div className="ons-card space-y-3">
          <div className="flex items-center gap-2">
            <Badge tone="success">Authenticated</Badge>
            <span className="font-medium">{result.productTitle}</span>
          </div>
          <p className="text-xs text-ink-400">
            Condition: {result.condition} · Serial: <code>{result.serialNumber}</code> · Status: {result.availability}
          </p>
          {result.checks.length > 0 && (
            <div className="border-t border-ink-800 pt-3 space-y-1">
              <p className="text-xs uppercase tracking-wider text-ink-400">Inspection history</p>
              {result.checks.map((c, idx) => (
                <div key={idx} className="text-xs">
                  <Badge tone={c.outcome === 'PASS' ? 'success' : c.outcome === 'FAIL' ? 'danger' : 'warning'}>{c.outcome}</Badge>
                  <span className="ml-2 text-ink-300">{new Date(c.createdAt).toLocaleString()}</span>
                  {c.reason && <span className="ml-2 text-ink-500">— {c.reason}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
