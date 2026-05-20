'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

function scoreTone(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 70) return 'success';
  if (score >= 40) return 'warning';
  return 'danger';
}

export default function AdminSellerHealthPage() {
  const { user, loading } = useAuth();
  const [rows, setRows] = React.useState<any[] | null>(null);
  const [maxScore, setMaxScore] = React.useState<string>('');

  React.useEffect(() => {
    if (loading || !user) return;
    api.sellerHealth.adminList(maxScore ? Number(maxScore) : undefined).then(setRows).catch(() => setRows([]));
  }, [loading, user, maxScore]);

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-3xl tracking-tight">Seller health</h1>
        <div className="flex items-center gap-2">
          <label className="text-sm text-ink-400">Max score</label>
          <input value={maxScore} onChange={(e) => setMaxScore(e.target.value)} type="number" min="0" max="100" placeholder="—" className="ons-input w-24" />
        </div>
      </div>
      {!rows ? <div className="text-ink-400">Loading…</div> :
       rows.length === 0 ? <p className="text-ink-400">No snapshots yet.</p> :
       <table className="w-full text-sm">
         <thead className="text-ink-400 text-xs uppercase">
           <tr>
             <th className="text-left py-2">Seller</th>
             <th className="text-right py-2">Score</th>
             <th className="text-right py-2">Disputes</th>
             <th className="text-right py-2">Chargebacks</th>
             <th className="text-right py-2">Returns</th>
             <th className="text-right py-2">SLA breach</th>
             <th className="text-right py-2">Status</th>
             <th className="text-right py-2">Captured</th>
           </tr>
         </thead>
         <tbody>
           {rows.map((r) => (
             <tr key={r.id} className="border-t border-ink-800">
               <td className="py-2">{r.seller.displayName}</td>
               <td className="py-2 text-right">
                 <Badge tone={scoreTone(r.score)}>{r.score}</Badge>
               </td>
               <td className="py-2 text-right">{(r.disputeRate * 100).toFixed(1)}%</td>
               <td className="py-2 text-right">{(r.chargebackRate * 100).toFixed(2)}%</td>
               <td className="py-2 text-right">{(r.returnRate * 100).toFixed(1)}%</td>
               <td className="py-2 text-right">{(r.slaBreachRate * 100).toFixed(1)}%</td>
               <td className="py-2 text-right">{r.seller.status}</td>
               <td className="py-2 text-right text-ink-400">{new Date(r.capturedAt).toLocaleDateString()}</td>
             </tr>
           ))}
         </tbody>
       </table>}
    </div>
  );
}
