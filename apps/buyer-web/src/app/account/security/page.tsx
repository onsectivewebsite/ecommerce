'use client';

import * as React from 'react';
import Link from 'next/link';
import { Badge, Button, Card, CardDescription, CardTitle, Input } from '@onsective/ui';
import type { LoginEventRow } from '@onsective/api-client';
import type {
  TwoFactorEnrollStart,
  TwoFactorStatus,
} from '@onsective/shared-types';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { PasskeysCard } from '@/components/PasskeysCard';

export default function SecurityActivityPage() {
  const { user, loading, refresh } = useAuth();
  const [rows, setRows] = React.useState<LoginEventRow[] | null>(null);
  const [tfStatus, setTfStatus] = React.useState<TwoFactorStatus | null>(null);
  const [enroll, setEnroll] = React.useState<TwoFactorEnrollStart | null>(null);
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<string | null>(null);

  const reloadStatus = React.useCallback(() => {
    api.auth.twoFactorStatus().then(setTfStatus).catch(() => setTfStatus(null));
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    api.security.loginEvents().then(setRows).catch(() => setRows([]));
    reloadStatus();
  }, [loading, user, reloadStatus]);

  async function onStartEnroll() {
    setBusy(true);
    setErr(null);
    setInfo(null);
    try {
      setEnroll(await api.auth.twoFactorEnrollStart());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start enrollment');
    } finally {
      setBusy(false);
    }
  }

  async function onVerifyEnroll(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await api.auth.twoFactorEnrollVerify(String(fd.get('code')));
      setEnroll(null);
      setRecoveryCodes(res.recoveryCodes);
      reloadStatus();
      refresh().catch(() => undefined);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  }

  async function onDisable(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setInfo(null);
    const fd = new FormData(e.currentTarget);
    try {
      await api.auth.twoFactorDisable(String(fd.get('code')));
      setInfo('Two-factor authentication disabled.');
      setRecoveryCodes(null);
      reloadStatus();
      refresh().catch(() => undefined);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  }

  async function onRegenerate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setInfo(null);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await api.auth.twoFactorRegenerateRecoveryCodes(String(fd.get('code')));
      setRecoveryCodes(res.recoveryCodes);
      reloadStatus();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!user)
    return (
      <div className="container py-16">
        <Link href="/login?next=/account/security" className="ons-btn-primary">
          Sign in
        </Link>
      </div>
    );

  return (
    <div className="container py-10 max-w-3xl space-y-10">
      <section>
        <h1 className="font-display text-3xl tracking-tight mb-6">Security</h1>
        {info && <p className="text-success text-sm mb-3">{info}</p>}
        {err && <p className="text-danger text-sm mb-3">{err}</p>}

        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Two-factor authentication</CardTitle>
              <CardDescription>
                Require a 6-digit code from an authenticator app every time you sign in.
              </CardDescription>
            </div>
            <Badge tone={tfStatus?.enabled ? 'success' : 'default'}>
              {tfStatus?.enabled ? 'On' : 'Off'}
            </Badge>
          </div>

          {/* Enrolled-state UI */}
          {tfStatus?.enabled && !enroll && !recoveryCodes && (
            <div className="mt-6 space-y-6">
              <div className="text-sm text-ink-300">
                <div>
                  Activated:{' '}
                  {tfStatus.activatedAt
                    ? new Date(tfStatus.activatedAt).toLocaleString()
                    : '—'}
                </div>
                <div>
                  Last used:{' '}
                  {tfStatus.lastUsedAt
                    ? new Date(tfStatus.lastUsedAt).toLocaleString()
                    : 'never'}
                </div>
                <div>Recovery codes remaining: {tfStatus.recoveryCodesRemaining}</div>
              </div>

              <form onSubmit={onRegenerate} className="border-t border-ink-800/40 pt-5 space-y-3">
                <div className="text-sm font-medium">Regenerate recovery codes</div>
                <p className="text-xs text-ink-400">
                  Replace all existing recovery codes with a fresh set of 10. Old codes stop working immediately.
                </p>
                <Input
                  label="Authenticator or recovery code"
                  name="code"
                  required
                  placeholder="123456 or XXXX-XXXX"
                  inputMode="text"
                />
                <Button loading={busy} type="submit" variant="ghost">
                  Regenerate
                </Button>
              </form>

              <form onSubmit={onDisable} className="border-t border-ink-800/40 pt-5 space-y-3">
                <div className="text-sm font-medium text-danger">Disable two-factor</div>
                <p className="text-xs text-ink-400">
                  We'll require a current code to confirm. All active sessions will be signed out.
                </p>
                <Input
                  label="Authenticator or recovery code"
                  name="code"
                  required
                  placeholder="123456 or XXXX-XXXX"
                  inputMode="text"
                />
                <Button loading={busy} type="submit" variant="ghost">
                  Disable
                </Button>
              </form>
            </div>
          )}

          {/* Off-state, no enrollment in progress */}
          {!tfStatus?.enabled && !enroll && !recoveryCodes && (
            <div className="mt-6">
              <Button loading={busy} onClick={onStartEnroll}>
                Set up two-factor authentication
              </Button>
            </div>
          )}

          {/* Enrollment in progress */}
          {enroll && (
            <div className="mt-6 space-y-5">
              <div>
                <div className="text-sm font-medium mb-2">1. Add a new entry to your authenticator app</div>
                <p className="text-xs text-ink-400 mb-3">
                  Use Google Authenticator, 1Password, Authy, or any RFC&nbsp;6238-compatible app. Either scan the URL with your app's QR scanner, or enter the secret manually.
                </p>
                <label className="block text-xs uppercase tracking-wider text-ink-500 mt-3">otpauth URL</label>
                <code className="block text-xs bg-ink-900/60 rounded p-2 break-all">{enroll.otpauthUrl}</code>
                <label className="block text-xs uppercase tracking-wider text-ink-500 mt-3">Secret (Base32)</label>
                <code className="block text-xs bg-ink-900/60 rounded p-2 break-all font-mono">{enroll.secretBase32}</code>
              </div>
              <form onSubmit={onVerifyEnroll} className="space-y-3 border-t border-ink-800/40 pt-5">
                <div className="text-sm font-medium">2. Verify with a code from your app</div>
                <Input
                  label="6-digit code"
                  name="code"
                  required
                  pattern="\d{6}"
                  inputMode="numeric"
                  placeholder="123456"
                  autoComplete="one-time-code"
                  autoFocus
                />
                <div className="flex gap-3">
                  <Button loading={busy} type="submit">
                    Verify and enable
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setEnroll(null)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </div>
          )}

          {/* Show recovery codes one-shot after enrollment or regeneration */}
          {recoveryCodes && (
            <div className="mt-6 space-y-3 border-t border-ink-800/40 pt-5">
              <div className="text-sm font-medium">Save your recovery codes</div>
              <p className="text-xs text-warning">
                Store these somewhere safe — a password manager works well. Each code can be used exactly once if you lose access to your authenticator. We won't show them again.
              </p>
              <div className="grid grid-cols-2 gap-2 font-mono text-sm bg-ink-900/60 rounded p-3">
                {recoveryCodes.map((c) => (
                  <div key={c}>{c}</div>
                ))}
              </div>
              <Button variant="ghost" onClick={() => setRecoveryCodes(null)}>
                I've saved them
              </Button>
            </div>
          )}
        </Card>
      </section>

      <section>
        <PasskeysCard />
      </section>

      <section>
        <h2 className="font-display text-2xl tracking-tight mb-3">Recent activity</h2>
        <p className="text-sm text-ink-400 mb-6">
          Recent sign-ins to your account. If you see anything you don't recognize, change your password and contact support immediately.
        </p>
        {!rows ? (
          <p className="text-ink-400">Loading activity…</p>
        ) : rows.length === 0 ? (
          <p className="text-ink-400">No sign-ins recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((e) => (
              <div key={e.id} className="ons-card flex items-center gap-3 text-sm">
                <Badge tone={e.outcome === 'SUCCESS' ? (e.anomaly ? 'warning' : 'success') : 'danger'}>
                  {e.outcome === 'SUCCESS' ? 'Sign-in' : 'Failed attempt'}
                </Badge>
                <div className="flex-1">
                  <div>
                    {new Date(e.occurredAt).toLocaleString()}
                    {e.country && <span className="ml-2 text-ink-400">{e.country}</span>}
                  </div>
                  {(e.newDevice || e.anomaly) && (
                    <div className="text-xs text-warning mt-0.5">
                      {e.anomaly ?? 'New device'}
                    </div>
                  )}
                  <div className="text-[10px] text-ink-500 font-mono">device {e.uaFingerprint.slice(0, 8)}…</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
