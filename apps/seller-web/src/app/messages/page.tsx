'use client';

import * as React from 'react';
import Link from 'next/link';
import { Badge } from '@onsective/ui';
import type { ThreadSummary } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function SellerThreadsPage() {
  const { user, loading } = useAuth();
  const [rows, setRows] = React.useState<ThreadSummary[] | null>(null);

  React.useEffect(() => {
    if (loading || !user) return;
    api.messaging.threads().then(setRows).catch(() => setRows([]));
  }, [loading, user]);

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!rows) return <div className="container py-16 text-ink-400">Loading messages…</div>;

  return (
    <div className="container py-10 max-w-3xl">
      <h1 className="font-display text-3xl tracking-tight mb-6">Messages</h1>
      {rows.length === 0 ? (
        <p className="text-ink-400">No active threads.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((t) => (
            <Link key={t.id} href={`/messages/${t.id}`} className="ons-card flex items-center justify-between hover:border-accent-500/40 transition-colors">
              <div>
                <div className="text-xs text-ink-400">Order #{t.orderId.slice(-8)}</div>
                <div className="text-sm">Last activity: {new Date(t.lastMessageAt).toLocaleString()}</div>
              </div>
              <div className="flex items-center gap-3">
                {t.unreadBySeller > 0 && <Badge tone="accent">{t.unreadBySeller} new</Badge>}
                <Badge tone={t.status === 'ESCALATED' ? 'danger' : 'neutral'}>{t.status}</Badge>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
