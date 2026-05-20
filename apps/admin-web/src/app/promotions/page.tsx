'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type { PromotionRow, PromotionScope } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function AdminPromotionsPage() {
  const { user, loading } = useAuth();
  const [scope, setScope] = React.useState<PromotionScope | ''>('');
  const [rows, setRows] = React.useState<PromotionRow[] | null>(null);

  React.useEffect(() => {
    if (loading || !user) return;
    api.promotions.adminList(scope || undefined).then(setRows).catch(() => setRows([]));
  }, [loading, user, scope]);

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-3xl tracking-tight">Promotions</h1>
        <select value={scope} onChange={(e) => setScope(e.target.value as PromotionScope)} className="ons-input">
          <option value="">All scopes</option>
          <option value="SELLER">Seller</option>
          <option value="PLATFORM">Platform</option>
        </select>
      </div>
      {!rows ? <div className="text-ink-400">Loading…</div> :
       rows.length === 0 ? <p className="text-ink-400">No promotions.</p> :
       <div className="space-y-2">
         {rows.map((p) => (
           <div key={p.id} className="ons-card flex items-center gap-4">
             <div className="flex-1">
               <div className="font-mono font-medium">{p.code}</div>
               <div className="text-xs text-ink-400">
                 {p.scope} · {p.kind.replace(/_/g, ' ')}
                 {p._count && ` · ${p._count.redemptions} used`}
                 {p.sellerId && ` · seller ${p.sellerId.slice(-6)}`}
               </div>
             </div>
             <Badge tone={p.status === 'ACTIVE' ? 'success' : 'danger'}>{p.status}</Badge>
           </div>
         ))}
       </div>}
    </div>
  );
}
