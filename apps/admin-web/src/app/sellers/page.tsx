'use client';

import * as React from 'react';
import { Badge, Button } from '@onsective/ui';
import type { SellerAdminDto, SellerStatus } from '@onsective/shared-types';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function SellersPage() {
  const { user, loading } = useAuth();
  const [filter, setFilter] = React.useState<SellerStatus | 'ALL'>('PENDING');
  const [list, setList] = React.useState<SellerAdminDto[] | null>(null);

  const reload = React.useCallback(() => {
    if (!user) return;
    api.admin.listSellers(filter === 'ALL' ? undefined : filter).then(setList);
  }, [user, filter]);

  React.useEffect(() => { if (!loading && user) reload(); }, [loading, user, reload]);

  async function approve(id: string) {
    await api.admin.approveSeller(id);
    reload();
  }
  async function reject(id: string) {
    const reason = prompt('Reason for rejection?') ?? undefined;
    await api.admin.rejectSeller(id, reason);
    reload();
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-3xl tracking-tight">Sellers</h1>
        <div className="flex gap-2">
          {(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'ALL'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={[
                'rounded-lg px-3 py-1.5 text-sm transition-colors',
                filter === s ? 'bg-ink-800 text-ink-50' : 'text-ink-400 hover:bg-ink-800/60',
              ].join(' ')}
            >{s}</button>
          ))}
        </div>
      </div>

      {!list ? <p className="text-ink-400">Loading…</p> : list.length === 0 ? (
        <p className="text-ink-400">No sellers in this state.</p>
      ) : (
        <div className="ons-card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-900 text-ink-400">
              <tr>
                <th className="text-left p-3">Store</th>
                <th className="text-left p-3">Owner</th>
                <th className="text-left p-3">Status</th>
                <th className="text-right p-3">Commission</th>
                <th className="text-right p-3">Created</th>
                <th className="text-right p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className="border-t border-ink-800">
                  <td className="p-3 font-medium">{s.displayName}<br /><span className="text-xs text-ink-400">/{s.storeName}</span></td>
                  <td className="p-3">{s.ownerName}<br /><span className="text-xs text-ink-400">{s.ownerEmail}</span></td>
                  <td className="p-3"><Badge tone={s.status === 'APPROVED' ? 'success' : s.status === 'PENDING' ? 'warning' : 'danger'}>{s.status}</Badge></td>
                  <td className="p-3 text-right">{s.commissionBps != null ? `${(s.commissionBps / 100).toFixed(2)}%` : '—'}</td>
                  <td className="p-3 text-right text-ink-400">{new Date(s.createdAt).toLocaleDateString()}</td>
                  <td className="p-3 text-right space-x-2">
                    {s.status !== 'APPROVED' && <Button size="sm" onClick={() => approve(s.id)}>Approve</Button>}
                    {s.status !== 'REJECTED' && <Button size="sm" variant="danger" onClick={() => reject(s.id)}>Reject</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
