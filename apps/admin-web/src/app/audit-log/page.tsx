'use client';

import * as React from 'react';
import { Badge, Card, CardDescription, CardTitle, Input } from '@onsective/ui';
import type { AuditEntryDto } from '@onsective/shared-types';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

function summarize(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

export default function AuditLogPage() {
  const { user, loading } = useAuth();
  const [entries, setEntries] = React.useState<AuditEntryDto[] | null>(null);
  const [entityType, setEntityType] = React.useState('');
  const [actorUserId, setActorUserId] = React.useState('');

  const reload = React.useCallback(() => {
    if (!user) return;
    api.admin.auditLog({
      entityType: entityType || undefined,
      actorUserId: actorUserId || undefined,
    }).then(setEntries).catch(() => setEntries([]));
  }, [user, entityType, actorUserId]);

  React.useEffect(() => { if (!loading && user) reload(); }, [loading, user, reload]);

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-10 space-y-6">
      <header>
        <h1 className="font-display text-3xl tracking-tight">Audit log</h1>
        <p className="text-ink-400 text-sm">Append-only record of every privileged change.</p>
      </header>

      <Card>
        <CardTitle>Filters</CardTitle>
        <CardDescription>Recent 200 entries by default.</CardDescription>
        <div className="mt-3 grid md:grid-cols-3 gap-3">
          <Input label="Entity type" value={entityType} onChange={(e) => setEntityType(e.target.value)} placeholder="e.g. ListingFeeRule, Seller, AdminSetting" />
          <Input label="Actor user id" value={actorUserId} onChange={(e) => setActorUserId(e.target.value)} placeholder="ULID" />
        </div>
      </Card>

      {!entries ? <p className="text-ink-400">Loading…</p> : (
        <div className="ons-card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-900 text-ink-400">
              <tr>
                <th className="text-left p-3">When</th>
                <th className="text-left p-3">Actor</th>
                <th className="text-left p-3">Action</th>
                <th className="text-left p-3">Entity</th>
                <th className="text-left p-3">Before → After</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr><td colSpan={5} className="p-6 text-center text-ink-400">No entries match.</td></tr>
              ) : entries.map((e) => (
                <tr key={e.id} className="border-t border-ink-800 align-top">
                  <td className="p-3 text-ink-400 whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</td>
                  <td className="p-3 font-mono text-xs">{e.actorUserId?.slice(-8) ?? 'system'}</td>
                  <td className="p-3"><Badge tone="accent">{e.action}</Badge></td>
                  <td className="p-3">
                    <div>{e.entityType}</div>
                    <div className="text-xs text-ink-400">{e.entityId ?? '—'}</div>
                  </td>
                  <td className="p-3">
                    <div className="text-xs text-ink-400 font-mono">{summarize(e.before)}</div>
                    <div className="text-xs text-ink-200 font-mono">→ {summarize(e.after)}</div>
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
