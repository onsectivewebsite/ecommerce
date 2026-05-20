'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Card, CardDescription, CardTitle } from '@onsective/ui';
import { api } from '@/lib/api';

type State =
  | { kind: 'loading' }
  | { kind: 'confirmed'; eligibleAt: string }
  | { kind: 'error'; message: string };

function countdown(toIso: string): string {
  const ms = new Date(toIso).getTime() - Date.now();
  if (ms <= 0) return 'now';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

export default function RecoveryConfirmPage() {
  const sp = useSearchParams();
  const token = sp.get('token') ?? '';
  const [state, setState] = React.useState<State>({ kind: 'loading' });
  const [, force] = React.useReducer((n) => n + 1, 0);

  React.useEffect(() => {
    if (!token) {
      setState({ kind: 'error', message: 'This link is missing its token.' });
      return;
    }
    api.auth
      .recoveryConfirm(token)
      .then((r) => setState({ kind: 'confirmed', eligibleAt: r.eligibleAt }))
      .catch((e: Error) => setState({ kind: 'error', message: e.message }));
  }, [token]);

  // Re-render once a minute so the countdown ticks.
  React.useEffect(() => {
    const t = setInterval(force, 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="container py-16 max-w-lg">
      <Card>
        {state.kind === 'loading' && (
          <>
            <CardTitle>Confirming…</CardTitle>
            <CardDescription>One moment.</CardDescription>
          </>
        )}
        {state.kind === 'confirmed' && (
          <>
            <CardTitle>Recovery in progress</CardTitle>
            <CardDescription>
              Your 72-hour security waiting period has started. You'll be able to remove two-factor in about{' '}
              <strong>{countdown(state.eligibleAt)}</strong> — on{' '}
              {new Date(state.eligibleAt).toLocaleString()}.
            </CardDescription>
            <p className="text-sm text-ink-400 mt-4">
              We'll email you a link to finish once the wait is over. If you didn't start this, use the "cancel" link in any of our recovery emails to stop it immediately.
            </p>
            <p className="text-sm text-ink-400 mt-6">
              <Link href="/">Back to Onsective</Link>
            </p>
          </>
        )}
        {state.kind === 'error' && (
          <>
            <CardTitle>Couldn't confirm recovery</CardTitle>
            <CardDescription>{state.message}</CardDescription>
            <p className="text-sm text-ink-400 mt-6">
              <Link href="/account-recovery">Start over</Link>
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
