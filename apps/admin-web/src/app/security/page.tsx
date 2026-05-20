'use client';

import * as React from 'react';
import { Button, Card, CardDescription, CardTitle, Input } from '@onsective/ui';
import type { RecoveryRequestRow } from '@onsective/api-client';
import { api } from '@/lib/api';

export default function AdminSecurityPage() {
  const [tfUserId, setTfUserId] = React.useState('');
  const [tfBusy, setTfBusy] = React.useState(false);
  const [tfMsg, setTfMsg] = React.useState<string | null>(null);
  const [tfErr, setTfErr] = React.useState<string | null>(null);

  const [pkUserId, setPkUserId] = React.useState('');
  const [pkBusy, setPkBusy] = React.useState(false);
  const [pkMsg, setPkMsg] = React.useState<string | null>(null);
  const [pkErr, setPkErr] = React.useState<string | null>(null);

  const [recovery, setRecovery] = React.useState<RecoveryRequestRow[] | null>(null);
  const [recoveryErr, setRecoveryErr] = React.useState<string | null>(null);

  const loadRecovery = React.useCallback(() => {
    api.admin
      .recoveryRequests()
      .then(setRecovery)
      .catch((e: Error) => setRecoveryErr(e.message));
  }, []);

  React.useEffect(() => {
    loadRecovery();
  }, [loadRecovery]);

  async function onCancelRecovery(id: string) {
    if (!confirm('Cancel this recovery request? The user will be notified.')) return;
    try {
      await api.admin.cancelRecoveryRequest(id);
      loadRecovery();
    } catch (e) {
      setRecoveryErr(e instanceof Error ? e.message : 'Cancel failed');
    }
  }

  async function onResetTotp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!tfUserId) return;
    setTfBusy(true);
    setTfErr(null);
    setTfMsg(null);
    try {
      await api.admin.resetUserTwoFactor(tfUserId.trim());
      setTfMsg(`Two-factor reset for user ${tfUserId.trim()}. Their authenticator entry, recovery codes, and active sessions have been invalidated.`);
      setTfUserId('');
    } catch (e) {
      setTfErr(e instanceof Error ? e.message : 'Reset failed');
    } finally {
      setTfBusy(false);
    }
  }

  async function onResetPasskeys(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!pkUserId) return;
    setPkBusy(true);
    setPkErr(null);
    setPkMsg(null);
    try {
      await api.admin.resetUserWebauthn(pkUserId.trim());
      setPkMsg(`Passkeys reset for user ${pkUserId.trim()}. All enrolled credentials have been deleted.`);
      setPkUserId('');
    } catch (e) {
      setPkErr(e instanceof Error ? e.message : 'Reset failed');
    } finally {
      setPkBusy(false);
    }
  }

  return (
    <div className="container py-10 max-w-2xl space-y-6">
      <h1 className="font-display text-3xl tracking-tight mb-6">Security operations</h1>

      <Card>
        <CardTitle>Reset user two-factor</CardTitle>
        <CardDescription>
          Use when a user has lost access to their authenticator app <em>and</em> exhausted or lost their recovery codes. This action:
        </CardDescription>
        <ul className="text-sm text-ink-400 list-disc pl-5 mt-3 space-y-1">
          <li>Deletes the user's TOTP enrollment and all recovery codes.</li>
          <li>Revokes every active refresh token (forces re-login everywhere).</li>
          <li>Audits the action against your admin user ID.</li>
          <li>Lets the user sign in with only their password on next attempt and re-enroll if they want.</li>
        </ul>
        <form onSubmit={onResetTotp} className="mt-6 flex flex-col gap-3">
          <Input
            label="User ID"
            value={tfUserId}
            onChange={(e) => setTfUserId(e.currentTarget.value)}
            placeholder="u_…"
            required
          />
          {tfMsg && <p className="text-success text-sm">{tfMsg}</p>}
          {tfErr && <p className="text-danger text-sm">{tfErr}</p>}
          <Button loading={tfBusy} type="submit" variant="primary">
            Reset two-factor
          </Button>
        </form>
      </Card>

      <Card>
        <CardTitle>Reset user passkeys</CardTitle>
        <CardDescription>
          Use when a user has lost the device hosting their passkey(s) and has no other recovery factor. Deletes every WebAuthn credential for the user; if TOTP is also enrolled, that remains.
        </CardDescription>
        <form onSubmit={onResetPasskeys} className="mt-6 flex flex-col gap-3">
          <Input
            label="User ID"
            value={pkUserId}
            onChange={(e) => setPkUserId(e.currentTarget.value)}
            placeholder="u_…"
            required
          />
          {pkMsg && <p className="text-success text-sm">{pkMsg}</p>}
          {pkErr && <p className="text-danger text-sm">{pkErr}</p>}
          <Button loading={pkBusy} type="submit" variant="primary">
            Reset passkeys
          </Button>
        </form>
      </Card>

      <Card>
        <CardTitle>In-flight account recoveries</CardTitle>
        <CardDescription>
          2FA-lockout recoveries currently in their 72-hour waiting window. Cancel one if it looks fraudulent — the user is emailed either way.
        </CardDescription>
        {recoveryErr && <p className="text-danger text-sm mt-3">{recoveryErr}</p>}
        {!recovery ? (
          <p className="text-ink-400 text-sm mt-4">Loading…</p>
        ) : recovery.length === 0 ? (
          <p className="text-ink-400 text-sm mt-4">No recoveries in progress.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="text-sm w-full">
              <thead className="text-ink-400 text-left">
                <tr>
                  <th className="py-2 pr-3">User</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Requested</th>
                  <th className="py-2 pr-3">Eligible</th>
                  <th className="py-2 pr-3">Reminders</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {recovery.map((r) => (
                  <tr key={r.id} className="border-t border-ink-800">
                    <td className="py-2 pr-3">
                      <div>{r.name || r.email}</div>
                      <div className="text-xs text-ink-400">{r.email}</div>
                    </td>
                    <td className="py-2 pr-3">{r.status}</td>
                    <td className="py-2 pr-3 text-ink-300">{new Date(r.requestedAt).toLocaleString()}</td>
                    <td className="py-2 pr-3 text-ink-300">
                      {r.eligibleAt ? new Date(r.eligibleAt).toLocaleString() : '—'}
                    </td>
                    <td className="py-2 pr-3 text-ink-300">{r.remindersSent}</td>
                    <td className="py-2">
                      <button
                        onClick={() => onCancelRecovery(r.id)}
                        className="text-danger hover:underline text-xs"
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
