'use client';

import * as React from 'react';
import { Badge, Button, Card, CardDescription, CardTitle, Input } from '@onsective/ui';
import type { WebAuthnCredentialRow } from '@onsective/api-client';
import { api } from '@/lib/api';
import {
  createCredential,
  describeError,
  isWebAuthnSupported,
} from '@/lib/webauthn';

const ALG_NAMES: Record<number, string> = {
  [-7]: 'ES256',
  [-257]: 'RS256',
  [-8]: 'EdDSA',
};

export function PasskeysCard() {
  const [creds, setCreds] = React.useState<WebAuthnCredentialRow[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<string | null>(null);
  const [label, setLabel] = React.useState('My device');
  const supported = React.useMemo(() => isWebAuthnSupported(), []);

  const reload = React.useCallback(() => {
    api.auth.webauthnCredentials().then(setCreds).catch(() => setCreds([]));
  }, []);

  React.useEffect(() => {
    reload();
  }, [reload]);

  async function onAdd() {
    setBusy(true);
    setErr(null);
    setInfo(null);
    try {
      const opts = await api.auth.webauthnRegisterOptions(label.trim() || 'Passkey');
      const enrolled = await createCredential(opts.publicKey);
      await api.auth.webauthnRegisterVerify({
        challenge: opts.challenge,
        credentialId: enrolled.credentialId,
        clientDataJSON: enrolled.clientDataJSON,
        attestationObject: enrolled.attestationObject,
        transports: enrolled.transports,
        label: label.trim() || 'Passkey',
      });
      setAdding(false);
      setLabel('My device');
      setInfo('Passkey added. You can now sign in with it.');
      reload();
    } catch (e) {
      setErr(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(id: string) {
    if (!confirm('Remove this passkey?')) return;
    setBusy(true);
    try {
      await api.auth.webauthnRemoveCredential(id);
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not remove');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <CardTitle>Passkeys</CardTitle>
          <CardDescription>
            Sign in with Touch ID, Face ID, Windows Hello, or a security key. Stronger than a password — and you can use a passkey in place of an authenticator code.
          </CardDescription>
        </div>
        <Badge tone={creds && creds.length > 0 ? 'success' : 'default'}>
          {creds ? `${creds.length} enrolled` : '…'}
        </Badge>
      </div>

      {info && <p className="text-success text-sm mt-3">{info}</p>}
      {err && <p className="text-danger text-sm mt-3">{err}</p>}

      {!supported && (
        <p className="text-warning text-sm mt-4">
          Your browser doesn't support passkeys. Try a recent version of Safari, Chrome, Firefox, or Edge.
        </p>
      )}

      {creds && creds.length > 0 && (
        <ul className="mt-4 space-y-2">
          {creds.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 border-t border-ink-800/40 pt-3 first:border-t-0 first:pt-0">
              <div className="text-sm">
                <div className="font-medium">{c.label}</div>
                <div className="text-xs text-ink-400">
                  {ALG_NAMES[c.algorithm] ?? `alg ${c.algorithm}`}
                  {c.transports.length > 0 && ` · ${c.transports.join('/').toLowerCase()}`}
                  {c.userVerified && ' · verified'}
                </div>
                <div className="text-xs text-ink-500">
                  Added {new Date(c.createdAt).toLocaleDateString()}
                  {c.lastUsedAt ? ` · last used ${new Date(c.lastUsedAt).toLocaleDateString()}` : ' · never used'}
                </div>
              </div>
              <Button variant="ghost" onClick={() => onRemove(c.id)} disabled={busy}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {supported && (
        <div className="mt-5">
          {adding ? (
            <div className="flex flex-col gap-3 border-t border-ink-800/40 pt-5">
              <Input
                label="Passkey name"
                value={label}
                onChange={(e) => setLabel(e.currentTarget.value)}
                placeholder="MacBook, iPhone, YubiKey…"
                autoFocus
              />
              <div className="flex gap-2">
                <Button onClick={onAdd} loading={busy}>
                  Create passkey
                </Button>
                <Button variant="ghost" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button onClick={() => setAdding(true)} disabled={busy}>
              Add a passkey
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
