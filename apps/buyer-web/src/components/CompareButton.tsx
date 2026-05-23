'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export function CompareButton({ productId, slug }: { productId: string; slug: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const [inSet, setInSet] = React.useState(false);
  const [count, setCount] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!user) return;
    api.comparison
      .list()
      .then((rows) => {
        setCount(rows.length);
        setInSet(rows.some((r) => r.productId === productId));
      })
      .catch(() => undefined);
  }, [user, productId]);

  async function toggle() {
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(`/p/${slug}`)}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const rows = inSet
        ? await api.comparison.remove(productId)
        : await api.comparison.add(productId);
      setCount(rows.length);
      setInSet(rows.some((r) => r.productId === productId));
    } catch (e) {
      setError((e as Error).message || 'Could not update comparison.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={toggle} disabled={busy} className="ons-btn-ghost text-sm">
          {inSet ? '✓ In comparison' : '+ Add to compare'}
        </button>
        {count > 0 && (
          <Link href="/compare" className="text-sm text-accent-300 underline">
            Compare ({count})
          </Link>
        )}
      </div>
      {error && <p className="text-danger text-sm mt-1">{error}</p>}
    </div>
  );
}
