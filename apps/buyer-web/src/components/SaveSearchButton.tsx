'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export function SaveSearchButton({ q }: { q: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!user) return;
    api.savedSearches
      .list()
      .then((rows) => setSaved(rows.some((r) => r.q.toLowerCase() === q.toLowerCase())))
      .catch(() => undefined);
  }, [user, q]);

  async function save() {
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(`/search?query=${q}`)}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.savedSearches.create({ q });
      setSaved(true);
    } catch (e) {
      setError((e as Error).message || 'Could not save this search.');
    } finally {
      setBusy(false);
    }
  }

  if (!q.trim()) return null;
  return (
    <div className="inline-flex items-center gap-3">
      <button type="button" onClick={save} disabled={busy || saved} className="ons-btn-ghost text-sm">
        {saved ? '✓ Saved' : '☆ Save this search'}
      </button>
      {error && <span className="text-danger text-sm">{error}</span>}
    </div>
  );
}
