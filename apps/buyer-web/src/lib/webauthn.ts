/**
 * Browser-side WebAuthn helper. Converts the server's base64url payloads
 * into the ArrayBuffers `navigator.credentials.*` expects, then converts
 * the response back into base64url strings the server can verify.
 *
 * Spec: https://w3c.github.io/webauthn/
 */

import type {
  WebAuthnRegisterOptions,
  WebAuthnLoginOptions,
} from '@onsective/api-client';

function b64urlToBytes(s: string): Uint8Array {
  // atob doesn't handle URL-safe alphabet; convert first.
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - (s.length % 4)) % 4), '=');
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.PublicKeyCredential &&
    typeof navigator !== 'undefined' &&
    !!navigator.credentials &&
    typeof navigator.credentials.create === 'function'
  );
}

/** Convert server options → browser-shaped PublicKeyCredentialCreationOptions. */
function toCreationOptions(o: WebAuthnRegisterOptions['publicKey']): PublicKeyCredentialCreationOptions {
  return {
    rp: o.rp,
    user: {
      id: b64urlToBytes(o.user.id),
      name: o.user.name,
      displayName: o.user.displayName,
    },
    challenge: b64urlToBytes(o.challenge),
    pubKeyCredParams: o.pubKeyCredParams,
    timeout: o.timeout,
    attestation: o.attestation,
    authenticatorSelection: o.authenticatorSelection,
    excludeCredentials: o.excludeCredentials.map((c) => ({
      type: c.type,
      id: b64urlToBytes(c.id),
      transports: c.transports as AuthenticatorTransport[] | undefined,
    })),
  };
}

function toRequestOptions(o: WebAuthnLoginOptions['publicKey']): PublicKeyCredentialRequestOptions {
  return {
    challenge: b64urlToBytes(o.challenge),
    rpId: o.rpId,
    timeout: o.timeout,
    userVerification: o.userVerification,
    allowCredentials: o.allowCredentials.map((c) => ({
      type: c.type,
      id: b64urlToBytes(c.id),
      transports: c.transports as AuthenticatorTransport[] | undefined,
    })),
  };
}

export async function createCredential(opts: WebAuthnRegisterOptions['publicKey']) {
  const cred = (await navigator.credentials.create({
    publicKey: toCreationOptions(opts),
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Authenticator returned no credential');
  const r = cred.response as AuthenticatorAttestationResponse;
  return {
    credentialId: bytesToB64url(cred.rawId),
    clientDataJSON: bytesToB64url(r.clientDataJSON),
    attestationObject: bytesToB64url(r.attestationObject),
    transports: (r.getTransports?.() ?? []) as string[],
  };
}

export async function getAssertion(opts: WebAuthnLoginOptions['publicKey']) {
  const cred = (await navigator.credentials.get({
    publicKey: toRequestOptions(opts),
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Authenticator returned no credential');
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    credentialId: bytesToB64url(cred.rawId),
    clientDataJSON: bytesToB64url(r.clientDataJSON),
    authenticatorData: bytesToB64url(r.authenticatorData),
    signature: bytesToB64url(r.signature),
    userHandle: r.userHandle ? bytesToB64url(r.userHandle) : undefined,
  };
}

/** Convenience: a single English error suitable for a toast. */
export function describeError(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === 'NotAllowedError') return 'You declined or no passkey was selected.';
    if (e.name === 'InvalidStateError') return 'This passkey is already registered.';
    if (e.name === 'NotSupportedError') return 'Your browser does not support passkeys yet.';
    if (e.name === 'SecurityError') return 'Origin mismatch — please reload and try again.';
  }
  return e instanceof Error ? e.message : String(e);
}
