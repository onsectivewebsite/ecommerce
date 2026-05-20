'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button, Card, CardDescription, CardTitle } from '@onsective/ui';
import type { UnsubscribeLookupResult } from '@onsective/api-client';
import { api } from '@/lib/api';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; data: UnsubscribeLookupResult }
  | { kind: 'done'; email: string; alreadyDone: boolean }
  | { kind: 'error'; message: string };

const FRIENDLY_CATEGORY: Record<string, string> = {
  marketingEmail: 'marketing emails',
  marketingSms: 'marketing SMS',
  marketingPush: 'marketing push notifications',
  marketing: 'all marketing communications',
};

function friendly(category: string): string {
  return FRIENDLY_CATEGORY[category] ?? `category "${category}"`;
}

export default function UnsubscribePage() {
  const sp = useSearchParams();
  const token = sp.get('token') ?? '';
  const [state, setState] = React.useState<State>({ kind: 'loading' });
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!token) {
      setState({ kind: 'error', message: 'Missing unsubscribe link.' });
      return;
    }
    api.privacy
      .lookupUnsubscribe(token)
      .then((data) => setState({ kind: 'ready', data }))
      .catch((e: Error) => setState({ kind: 'error', message: e.message }));
  }, [token]);

  async function confirm() {
    if (state.kind !== 'ready' || !token) return;
    setBusy(true);
    try {
      const r = await api.privacy.consumeUnsubscribe(token);
      setState({
        kind: 'done',
        email: state.data.email,
        alreadyDone: r.alreadyDone,
      });
    } catch (e) {
      setState({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Could not unsubscribe',
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
            <CardTitle>Checking link…</CardTitle>
            <CardDescription>One moment.</CardDescription>
          </>
        )}
        {state.kind === 'ready' && (
          <>
            <CardTitle>Unsubscribe</CardTitle>
            <CardDescription>
              You're about to unsubscribe <strong>{state.data.email}</strong> from{' '}
              {friendly(state.data.category)}. Transactional emails (orders, shipping, security) will continue.
            </CardDescription>
            {state.data.alreadyDone ? (
              <p className="text-sm text-ink-400 mt-4">
                Looks like this link has already been used. Your preferences are already updated.
              </p>
            ) : (
              <Button onClick={confirm} loading={busy} className="mt-6">
                Confirm unsubscribe
              </Button>
            )}
            <p className="text-xs text-ink-500 mt-6">
              Want finer-grained control? Manage all preferences from{' '}
              <Link href="/account/preferences" className="underline">
                /account/preferences
              </Link>
              .
            </p>
          </>
        )}
        {state.kind === 'done' && (
          <>
            <CardTitle>You're unsubscribed</CardTitle>
            <CardDescription>
              We've updated preferences for <strong>{state.email}</strong>.{' '}
              {state.alreadyDone ? '(Already done previously.)' : ''}
            </CardDescription>
            <Link href="/account/preferences" className="ons-btn-primary mt-6 inline-block">
              Manage all preferences
            </Link>
          </>
        )}
        {state.kind === 'error' && (
          <>
            <CardTitle>Couldn't process this link</CardTitle>
            <CardDescription>{state.message}</CardDescription>
            <p className="text-sm text-ink-400 mt-4">
              You can still manage marketing preferences while signed in from{' '}
              <Link href="/account/preferences" className="underline">
                /account/preferences
              </Link>
              .
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
