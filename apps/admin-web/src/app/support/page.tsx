'use client';

import * as React from 'react';
import Link from 'next/link';
import { Badge } from '@onsective/ui';
import type { InboxThread } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

type Filter = 'escalated' | 'past_sla' | 'all' | '';

export default function SupportInboxPage() {
  const { user, loading } = useAuth();
  const [filter, setFilter] = React.useState<Filter>('');
  const [rows, setRows] = React.useState<InboxThread[] | null>(null);

  React.useEffect(() => {
    if (loading || !user) return;
    api.support.inbox(filter || undefined).then(setRows).catch(() => setRows([]));
  }, [loading, user, filter]);

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-3xl tracking-tight">Support inbox</h1>
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="ons-input">
          <option value="">Escalated + past SLA</option>
          <option value="escalated">Escalated only</option>
          <option value="past_sla">Past SLA only</option>
          <option value="all">All threads</option>
        </select>
      </div>
      {!rows ? <div className="text-ink-400">Loading…</div> :
       rows.length === 0 ? <p className="text-ink-400">Inbox zero.</p> :
       <div className="space-y-2">
         {rows.map((t) => (
           <Link key={t.id} href={`/support/${t.id}`} className="ons-card flex items-center gap-4 hover:border-accent-500/40 transition-colors">
             <div className="flex-1">
               <div className="text-xs text-ink-400">Order #{t.order.id.slice(-8)} · {t.seller.displayName}</div>
               <div className="text-sm">Last activity: {t.hoursSinceLast}h ago</div>
             </div>
             {t.slaBreached && <Badge tone="danger">Past SLA</Badge>}
             {t.dispute && <Badge tone="accent">{t.dispute.kind}</Badge>}
             <Badge tone={t.status === 'ESCALATED' ? 'danger' : 'neutral'}>{t.status}</Badge>
           </Link>
         ))}
       </div>}
    </div>
  );
}
