import type {
  AuthResponse,
  AuthUser,
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  TwoFactorEnrollStart,
  TwoFactorRecoveryCodes,
  TwoFactorStatus,
} from '@onsective/shared-types';
import { OnsectiveClient } from '../client';

export class AuthApi {
  constructor(private readonly client: OnsectiveClient) {}

  register(body: RegisterRequest) {
    return this.client.request<AuthResponse>('/auth/register', {
      method: 'POST',
      body,
      noAuth: true,
    });
  }

  /**
   * Phase 31: result may be either AuthResponse (no 2FA) or
   * MfaChallengeResponse (2FA on — caller must follow up with
   * `twoFactorVerifyLogin`).
   */
  login(body: LoginRequest) {
    return this.client.request<LoginResponse>('/auth/login', {
      method: 'POST',
      body,
      noAuth: true,
    });
  }

  refresh(body?: { refreshToken?: string }) {
    return this.client.request<AuthResponse>('/auth/refresh', {
      method: 'POST',
      noAuth: true,
      headers: { 'X-Refresh': '1' },
      body,
    });
  }

  logout(body?: { refreshToken?: string }) {
    return this.client.request<void>('/auth/logout', { method: 'POST', body });
  }

  me() {
    return this.client.request<AuthUser>('/auth/me');
  }

  // ─────────────────────────── Two-Factor ───────────────────────────

  twoFactorStatus() {
    return this.client.request<TwoFactorStatus>('/auth/2fa/status');
  }

  twoFactorEnrollStart() {
    return this.client.request<TwoFactorEnrollStart>('/auth/2fa/enroll/start', {
      method: 'POST',
    });
  }

  twoFactorEnrollVerify(code: string) {
    return this.client.request<TwoFactorRecoveryCodes>(
      '/auth/2fa/enroll/verify',
      { method: 'POST', body: { code } },
    );
  }

  twoFactorVerifyLogin(challenge: string, code: string) {
    return this.client.request<AuthResponse>('/auth/2fa/verify', {
      method: 'POST',
      noAuth: true,
      body: { challenge, code },
    });
  }

  twoFactorDisable(code: string) {
    return this.client.request<{ ok: true }>('/auth/2fa/disable', {
      method: 'POST',
      body: { code },
    });
  }

  twoFactorRegenerateRecoveryCodes(code: string) {
    return this.client.request<TwoFactorRecoveryCodes>(
      '/auth/2fa/recovery-codes/regenerate',
      { method: 'POST', body: { code } },
    );
  }

  // ─────────────────────────── Phase 33: WebAuthn ───────────────────────────

  webauthnRegisterOptions(label: string) {
    return this.client.request<WebAuthnRegisterOptions>('/auth/webauthn/register/options', {
      method: 'POST',
      body: { label },
    });
  }

  webauthnRegisterVerify(body: {
    challenge: string;
    credentialId: string;
    clientDataJSON: string;
    attestationObject: string;
    transports?: string[];
    label: string;
  }) {
    return this.client.request<{ id: string; label: string; createdAt: string }>(
      '/auth/webauthn/register/verify',
      { method: 'POST', body },
    );
  }

  webauthnLoginOptions(email?: string) {
    return this.client.request<WebAuthnLoginOptions>('/auth/webauthn/login/options', {
      method: 'POST',
      noAuth: true,
      body: email ? { email } : {},
    });
  }

  webauthnLoginVerify(body: {
    challenge: string;
    credentialId: string;
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string;
  }) {
    return this.client.request<AuthResponse & { method: 'webauthn' }>(
      '/auth/webauthn/login/verify',
      { method: 'POST', noAuth: true, body },
    );
  }

  twoFactorVerifyPasskey(body: {
    loginChallenge: string;
    challenge: string;
    credentialId: string;
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
  }) {
    return this.client.request<AuthResponse & { method: 'webauthn' }>(
      '/auth/2fa/verify-passkey',
      { method: 'POST', noAuth: true, body },
    );
  }

  webauthnCredentials() {
    return this.client.request<WebAuthnCredentialRow[]>('/auth/webauthn/credentials');
  }

  webauthnRemoveCredential(id: string) {
    return this.client.request<{ ok: true }>(
      `/auth/webauthn/credentials/${encodeURIComponent(id)}/remove`,
      { method: 'POST' },
    );
  }

  // ─────────────────────── Phase 34: Account Recovery ───────────────────────

  passwordForgot(email: string) {
    return this.client.request<{ ok: true }>('/auth/password/forgot', {
      method: 'POST',
      noAuth: true,
      body: { email },
    });
  }

  passwordReset(token: string, newPassword: string) {
    return this.client.request<{ ok: true; twoFactorRequired: boolean }>(
      '/auth/password/reset',
      { method: 'POST', noAuth: true, body: { token, newPassword } },
    );
  }

  recoveryStart(email: string) {
    return this.client.request<{ ok: true }>('/auth/recovery/start', {
      method: 'POST',
      noAuth: true,
      body: { email },
    });
  }

  recoveryConfirm(token: string) {
    return this.client.request<{ ok: true; eligibleAt: string }>(
      '/auth/recovery/confirm',
      { method: 'POST', noAuth: true, body: { token } },
    );
  }

  recoveryCancel(token: string) {
    return this.client.request<{ ok: true }>('/auth/recovery/cancel', {
      method: 'POST',
      noAuth: true,
      body: { token },
    });
  }

  recoveryStatus(token: string) {
    return this.client.request<RecoveryStatusResult>('/auth/recovery/status', {
      noAuth: true,
      query: { token },
    });
  }

  recoveryComplete(token: string) {
    return this.client.request<{ ok: true }>('/auth/recovery/complete', {
      method: 'POST',
      noAuth: true,
      body: { token },
    });
  }
}

export interface RecoveryStatusResult {
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';
  confirmedAt: string | null;
  eligibleAt: string | null;
  eligibleNow: boolean;
}

export interface RecoveryRequestRow {
  id: string;
  userId: string;
  email: string;
  name: string;
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';
  requestedAt: string;
  confirmedAt: string | null;
  eligibleAt: string | null;
  remindersSent: number;
}

export interface WebAuthnCredentialRow {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  algorithm: number;
  transports: string[];
  userVerified: boolean;
}

export interface WebAuthnRegisterOptions {
  publicKey: {
    rp: { id: string; name: string };
    user: { id: string; name: string; displayName: string };
    challenge: string;
    pubKeyCredParams: Array<{ type: 'public-key'; alg: number }>;
    timeout: number;
    attestation: 'none';
    authenticatorSelection: {
      residentKey: 'preferred' | 'required' | 'discouraged';
      userVerification: 'preferred' | 'required' | 'discouraged';
    };
    excludeCredentials: Array<{
      type: 'public-key';
      id: string;
      transports?: string[];
    }>;
  };
  challenge: string;
}

export interface WebAuthnLoginOptions {
  publicKey: {
    challenge: string;
    rpId: string;
    timeout: number;
    userVerification: 'preferred' | 'required' | 'discouraged';
    allowCredentials: Array<{
      type: 'public-key';
      id: string;
      transports?: string[];
    }>;
  };
  challenge: string;
}
