'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Card, CardDescription, CardTitle } from '@onsective/ui';
import { api } from '@/lib/api';

type State =
  | { kind: 'loading' }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

export default function RecoveryCancelPage() {
  const sp = useSearchParams();
  const token = sp.get('token') ?? '';
  const [state, setState] = React.useState<State>({ kind: 'loading' });

  React.useEffect(() => {
    if (!token) {
      setState({ kind: 'error', message: 'This link is missing its token.' });
      return;
    }
    api.auth
      .recoveryCancel(token)
      .then(() => setState({ kind: 'cancelled' }))
      .catch((e: Error) => setState({ kind: 'error', message: e.message }));
  }, [token]);

  return (
    <div className="container py-16 max-w-lg">
      <Card>
        {state.kind === 'loading' && (
          <>
            <CardTitle>Cancelling…</CardTitle>
            <CardDescription>One moment.</CardDescription>
          </>
        )}
        {state.kind === 'cancelled' && (
          <>
            <CardTitle>Recovery cancelled</CardTitle>
            <CardDescription>
              The account recovery has been stopped. Nothing changed — your two-factor protection is still in place.
            </CardDescription>
            <p className="text-sm text-warning mt-4">
              If you didn't start this recovery, someone may know your password. Consider changing it from your security settings once you're signed in.
            </p>
            <p className="text-sm text-ink-400 mt-6">
              <Link href="/login">Sign in</Link>
            </p>
          </>
        )}
        {state.kind === 'error' && (
          <>
            <CardTitle>Couldn't cancel</CardTitle>
            <CardDescription>{state.message}</CardDescription>
            <p className="text-sm text-ink-400 mt-6">
              If you're worried about your account, <Link href="/login">sign in</Link> and review your security settings.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
