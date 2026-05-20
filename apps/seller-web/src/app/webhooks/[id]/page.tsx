'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@onsective/ui';
import type { WebhookDeliveryRow } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

function tone(s: WebhookDeliveryRow['status']): 'success' | 'danger' | 'accent' | 'neutral' {
  if (s === 'DELIVERED') return 'success';
  if (s === 'DEAD') return 'danger';
  if (s === 'RETRYING') return 'accent';
  return 'neutral';
}

export default function WebhookDeliveriesPage() {
  const params = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const [rows, setRows] = React.useState<WebhookDeliveryRow[] | null>(null);

  React.useEffect(() => {
    if (loading || !user) return;
    api.webhooks.deliveries(params.id).then(setRows).catch(() => setRows([]));
  }, [loading, user, params.id]);

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!rows) return <div className="container py-16 text-ink-400">Loading deliveries…</div>;

  return (
    <div className="container py-10 max-w-4xl">
      <Link href="/webhooks" className="text-sm text-accent-300 hover:underline">← back to webhooks</Link>
      <h1 className="font-display text-2xl tracking-tight mt-3 mb-6">Recent deliveries</h1>
      {rows.length === 0 ? (
        <p className="text-ink-400">No deliveries yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((d) => (
            <div key={d.id} className="ons-card text-sm">
              <div className="flex items-center gap-3">
                <Badge tone={tone(d.status)}>{d.status}</Badge>
                <code className="text-xs">{d.event}</code>
                <span className="text-ink-400 text-xs ml-auto">{new Date(d.createdAt).toLocaleString()}</span>
              </div>
              <div className="text-xs text-ink-400 mt-2">
                attempts={d.attempts}
                {d.lastResponseStatus != null && ` · http=${d.lastResponseStatus}`}
                {d.nextAttemptAt && ` · next attempt ${new Date(d.nextAttemptAt).toLocaleTimeString()}`}
              </div>
              {d.lastError && <div className="text-xs text-danger mt-1 break-all">{d.lastError}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
