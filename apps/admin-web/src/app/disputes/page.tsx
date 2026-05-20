'use client';

import * as React from 'react';
import Link from 'next/link';
import { Badge } from '@onsective/ui';
import type { DisputeRow, DisputeKind, DisputeStatus } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const KINDS: DisputeKind[] = ['RETURN', 'MISSING_DELIVERY', 'CHARGEBACK', 'OTHER'];
const STATUSES: DisputeStatus[] = ['OPEN', 'RESOLVED_BUYER', 'RESOLVED_SELLER', 'RESOLVED_SPLIT', 'CLOSED_NO_ACTION'];

function tone(s: DisputeStatus): 'success' | 'danger' | 'accent' | 'neutral' {
  if (s === 'OPEN') return 'accent';
  if (s.startsWith('RESOLVED')) return 'success';
  return 'neutral';
}

export default function AdminDisputesPage() {
  const { user, loading } = useAuth();
  const [status, setStatus] = React.useState<DisputeStatus | ''>('OPEN');
  const [kind, setKind] = React.useState<DisputeKind | ''>('');
  const [rows, setRows] = React.useState<DisputeRow[] | null>(null);

  React.useEffect(() => {
    if (loading || !user) return;
    api.disputes.adminList({
      status: status || undefined,
      kind: kind || undefined,
    }).then(setRows).catch(() => setRows([]));
  }, [loading, user, status, kind]);

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-3xl tracking-tight">Disputes</h1>
        <div className="flex gap-2">
          <select value={status} onChange={(e) => setStatus(e.target.value as DisputeStatus)} className="ons-input">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={kind} onChange={(e) => setKind(e.target.value as DisputeKind)} className="ons-input">
            <option value="">All kinds</option>
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
      </div>
      {!rows ? <div className="text-ink-400">Loading…</div> :
       rows.length === 0 ? <p className="text-ink-400">Nothing in queue.</p> :
       <div className="space-y-2">
         {rows.map((d) => (
           <Link key={d.id} href={`/disputes/${d.id}`} className="ons-card flex items-center gap-4 hover:border-accent-500/40 transition-colors">
             <div className="flex-1">
               <div className="text-xs text-ink-400">#{d.id.slice(-8)} · opened {new Date(d.openedAt).toLocaleString()}</div>
               <div className="font-medium">{d.kind}</div>
             </div>
             <Badge tone="neutral">{d.kind}</Badge>
             <Badge tone={tone(d.status)}>{d.status}</Badge>
           </Link>
         ))}
       </div>}
    </div>
  );
}
