'use client';

import * as React from 'react';
import Link from 'next/link';
import type { SavedSearchRow } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function SavedSearchesPage() {
  const { user, loading } = useAuth();
  const [rows, setRows] = React.useState<SavedSearchRow[] | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    api.savedSearches.list().then(setRows).catch(() => setRows([]));
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function remove(id: string) {
    if (!confirm('Delete this saved search?')) return;
    setBusyId(id);
    try { await api.savedSearches.remove(id); load(); }
    finally { setBusyId(null); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-10">
      <h1 className="font-display text-3xl tracking-tight mb-6">Saved searches</h1>
      {!rows ? <p className="text-ink-400">Loading…</p> :
        rows.length === 0 ? (
          <p className="text-ink-400">
            You haven&apos;t saved any searches yet. Try the{' '}
            <Link href="/search" className="text-accent-300">search</Link> page and hit{' '}
            <span className="text-accent-300">Save this search</span>.
          </p>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.id} className="ons-card">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-ink-100 truncate">
                      {r.name ?? r.q}
                    </div>
                    {r.name && <div className="text-xs text-ink-500">"{r.q}"</div>}
                    <div className="text-xs text-ink-500 mt-1">
                      {r.hitCount} {r.hitCount === 1 ? 'match' : 'matches'} · last checked {new Date(r.lastCheckedAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Link href={`/search?query=${encodeURIComponent(r.q)}`} className="ons-btn-secondary text-sm">Run now</Link>
                    <button disabled={busyId === r.id} onClick={() => remove(r.id)} className="ons-btn-ghost text-sm text-danger">Delete</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
