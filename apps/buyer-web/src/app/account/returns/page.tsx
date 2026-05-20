'use client';

import * as React from 'react';
import Link from 'next/link';
import { Badge } from '@onsective/ui';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import type { ReturnRow } from '@onsective/api-client';

function tone(status: string): 'success' | 'danger' | 'accent' | 'neutral' {
  switch (status) {
    case 'REFUNDED': return 'success';
    case 'REJECTED': return 'danger';
    case 'APPROVED':
    case 'SHIPPED':
    case 'RECEIVED': return 'accent';
    default: return 'neutral';
  }
}

export default function MyReturnsPage() {
  const { user, loading: authLoading } = useAuth();
  const [rows, setRows] = React.useState<ReturnRow[] | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (authLoading || !user) return;
    api.returns.mine().then(setRows).catch((e) => setErr(e?.message ?? 'Failed to load'));
  }, [authLoading, user]);

  if (authLoading) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!user) return <div className="container py-16"><Link href="/login?next=/account/returns" className="ons-btn-primary">Sign in</Link></div>;
  if (err) return <div className="container py-16 text-danger">{err}</div>;
  if (!rows) return <div className="container py-16 text-ink-400">Loading returns…</div>;

  return (
    <div className="container py-10 max-w-4xl">
      <h1 className="font-display text-3xl tracking-tight mb-6">Your returns</h1>
      {rows.length === 0 ? (
        <p className="text-ink-400">No returns yet. Start one from any delivered order.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="ons-card flex items-center gap-4">
              <div className="flex-1">
                <div className="text-xs text-ink-400">Return #{r.id.slice(-8)} · order #{r.orderId.slice(-8)}</div>
                <div className="font-medium">Reason: {r.reason.replace(/_/g, ' ').toLowerCase()}</div>
                <div className="text-xs text-ink-400">Opened {new Date(r.createdAt).toLocaleString()}</div>
                {r.sellerNote && <div className="text-xs text-ink-300 mt-1">Seller: {r.sellerNote}</div>}
              </div>
              <Badge tone={tone(r.status)}>{r.status.replace(/_/g, ' ')}</Badge>
              <div className="flex flex-col gap-1">
                {r.status === 'APPROVED' && (
                  <a
                    href="#"
                    onClick={async (e) => {
                      e.preventDefault();
                      const { url } = await api.returns.labelUrl(r.id);
                      window.open(url, '_blank');
                    }}
                    className="ons-btn-ghost text-sm"
                  >
                    Download label
                  </a>
                )}
                {(r.status === 'APPROVED' || r.status === 'SHIPPED') && (
                  <button
                    onClick={async () => {
                      const updated = await api.returns.markDropped(r.id);
                      setRows((cur) => cur?.map((x) => (x.id === r.id ? updated : x)) ?? null);
                    }}
                    className="ons-btn-ghost text-sm"
                  >
                    I dropped it off
                  </button>
                )}
                {r.status === 'REQUESTED' && (
                  <button
                    onClick={async () => {
                      if (!confirm('Cancel this return?')) return;
                      const updated = await api.returns.cancel(r.id);
                      setRows((cur) => cur?.map((x) => (x.id === r.id ? updated : x)) ?? null);
                    }}
                    className="ons-btn-ghost text-sm text-danger"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
