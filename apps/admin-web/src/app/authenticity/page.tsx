'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type { AuthenticityCheckRow } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function AdminAuthenticityPage() {
  const { user, loading } = useAuth();
  const [queue, setQueue] = React.useState<AuthenticityCheckRow[] | null>(null);
  const [recent, setRecent] = React.useState<AuthenticityCheckRow[]>([]);

  React.useEffect(() => {
    if (loading || !user) return;
    api.authenticity.adminQueue().then(setQueue).catch(() => setQueue([]));
    api.authenticity.list().then(setRecent).catch(() => setRecent([]));
  }, [loading, user]);

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!queue) return <div className="container py-16 text-ink-400">Loading queue…</div>;

  return (
    <div className="container py-10 space-y-10">
      <header>
        <h1 className="font-display text-3xl tracking-tight">Authenticity checks</h1>
        <p className="text-sm text-ink-400 mt-1">
          Every inbound unit must produce a PASS check before it goes live. NEEDS_REVIEW
          items wait here for ops sign-off.
        </p>
      </header>

      <section>
        <h2 className="font-medium mb-3">Needs review ({queue.length})</h2>
        {queue.length === 0 ? <p className="text-ink-400">Empty — all caught up.</p> : (
          <div className="space-y-2">
            {queue.map((r) => (
              <CheckCard key={r.id} row={r} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-medium mb-3">Recent activity</h2>
        <div className="space-y-2">
          {recent.slice(0, 50).map((r) => <CheckCard key={r.id} row={r} />)}
        </div>
      </section>
    </div>
  );
}

function CheckCard({ row }: { row: AuthenticityCheckRow }) {
  const tone =
    row.outcome === 'PASS' ? 'success'
    : row.outcome === 'FAIL' ? 'danger'
    : 'warning';
  return (
    <div className="ons-card flex items-center gap-3">
      <Badge tone={tone}>{row.outcome}</Badge>
      <div className="flex-1 text-sm">
        {row.serialNumber && <code className="text-xs text-ink-400">serial={row.serialNumber}</code>}
        {row.refurbUnitId && <span className="ml-2 text-xs text-ink-400">refurb={row.refurbUnitId.slice(-8)}</span>}
        {row.inboundItemId && <span className="ml-2 text-xs text-ink-400">inbound={row.inboundItemId.slice(-8)}</span>}
        {row.reason && <p className="text-xs text-ink-500 mt-1">{row.reason}</p>}
      </div>
      <span className="text-xs text-ink-500">{new Date(row.createdAt).toLocaleString()}</span>
    </div>
  );
}
