'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button, Card, CardDescription, CardTitle } from '@onsective/ui';
import type { RecoveryStatusResult } from '@onsective/api-client';
import { api } from '@/lib/api';

type State =
  | { kind: 'loading' }
  | { kind: 'status'; data: RecoveryStatusResult }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

function countdown(toIso: string): string {
  const ms = new Date(toIso).getTime() - Date.now();
  if (ms <= 0) return 'now';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

export default function RecoveryCompletePage() {
  const sp = useSearchParams();
  const token = sp.get('token') ?? '';
  const [state, setState] = React.useState<State>({ kind: 'loading' });
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    if (!token) {
      setState({ kind: 'error', message: 'This link is missing its token.' });
      return;
    }
    api.auth
      .recoveryStatus(token)
      .then((data) => setState({ kind: 'status', data }))
      .catch((e: Error) => setState({ kind: 'error', message: e.message }));
  }, [token]);

  React.useEffect(() => {
    load();
  }, [load]);

  // Refresh status every minute while we're waiting.
  React.useEffect(() => {
    if (state.kind !== 'status' || state.data.eligibleNow) return;
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [state, load]);

  async function onComplete() {
    setBusy(true);
    try {
      await api.auth.recoveryComplete(token);
      setState({ kind: 'done' });
    } catch (e) {
      setState({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Could not complete recovery',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container py-16 max-w-lg">
      <Card>
        {state.kind === 'loading' && (
          <>
            <CardTitle>Checking…</CardTitle>
            <CardDescription>One moment.</CardDescription>
          </>
        )}

        {state.kind === 'status' && state.data.status === 'CONFIRMED' && state.data.eligibleNow && (
          <>
            <CardTitle>Ready to finish recovery</CardTitle>
            <CardDescription>
              The 72-hour waiting period has passed. Click below to remove two-factor authentication from your account. All passkeys and authenticator enrollments will be cleared, and every active session will be signed out.
            </CardDescription>
            <Button onClick={onComplete} loading={busy} className="mt-6">
              Remove two-factor and recover account
            </Button>
          </>
        )}

        {state.kind === 'status' && state.data.status === 'CONFIRMED' && !state.data.eligibleNow && (
          <>
            <CardTitle>Recovery still in progress</CardTitle>
            <CardDescription>
              You'll be able to finish recovery in about{' '}
              <strong>{state.data.eligibleAt ? countdown(state.data.eligibleAt) : 'a while'}</strong>
              {state.data.eligibleAt && ` — on ${new Date(state.data.eligibleAt).toLocaleString()}`}.
            </CardDescription>
            <p className="text-sm text-ink-400 mt-4">
              We'll email you when it's ready. You can keep this page open — it refreshes automatically.
            </p>
          </>
        )}

        {state.kind === 'status' && state.data.status === 'PENDING' && (
          <>
            <CardTitle>Recovery not confirmed yet</CardTitle>
            <CardDescription>
              Open the recovery email and click "Continue recovery" first to start the waiting period.
            </CardDescription>
          </>
        )}

        {state.kind === 'status' &&
          ['CANCELLED', 'EXPIRED', 'COMPLETED'].includes(state.data.status) && (
            <>
              <CardTitle>This recovery is {state.data.status.toLowerCase()}</CardTitle>
              <CardDescription>
                {state.data.status === 'COMPLETED'
                  ? 'Two-factor has already been removed. You can sign in with your password.'
                  : 'Start a new recovery if you still need to regain access.'}
              </CardDescription>
              <p className="text-sm text-ink-400 mt-6">
                <Link href={state.data.status === 'COMPLETED' ? '/login' : '/account-recovery'}>
                  {state.data.status === 'COMPLETED' ? 'Sign in' : 'Start over'}
                </Link>
              </p>
            </>
          )}

        {state.kind === 'done' && (
          <>
            <CardTitle>Account recovered</CardTitle>
            <CardDescription>
              Two-factor authentication has been removed. Sign in with your password, then re-enroll an authenticator or passkey from your security settings.
            </CardDescription>
            <Link href="/login" className="ons-btn-primary mt-6 inline-block">
              Sign in
            </Link>
          </>
        )}

        {state.kind === 'error' && (
          <>
            <CardTitle>Something went wrong</CardTitle>
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
