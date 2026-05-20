'use client';

import * as React from 'react';
import type { AuthUser, LoginResponse } from '@onsective/shared-types';
import { api, setAccessToken } from './api';

type SignInResult =
  | { ok: true }
  | { mfaRequired: true; challenge: string };

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  signIn(email: string, password: string): Promise<SignInResult>;
  /** Phase 31: complete a 2FA-gated sign-in. */
  verifyTwoFactor(challenge: string, code: string): Promise<{ ok: true; usedRecoveryCode: boolean }>;
  signUp(email: string, password: string, firstName: string, lastName: string, referralCode?: string): Promise<void>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

function isMfaChallenge(r: LoginResponse): r is { mfaRequired: true; challenge: string } {
  return (r as { mfaRequired?: boolean }).mfaRequired === true;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    try {
      const r = await api.auth.refresh();
      setAccessToken(r.accessToken);
      setUser(r.user);
    } catch {
      setAccessToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const signIn = React.useCallback(async (email: string, password: string): Promise<SignInResult> => {
    const r = await api.auth.login({ email, password });
    if (isMfaChallenge(r)) {
      return { mfaRequired: true, challenge: r.challenge };
    }
    setAccessToken(r.accessToken);
    setUser(r.user);
    return { ok: true };
  }, []);

  const verifyTwoFactor = React.useCallback(
    async (challenge: string, code: string) => {
      const r = await api.auth.twoFactorVerifyLogin(challenge, code);
      setAccessToken(r.accessToken);
      setUser(r.user);
      return { ok: true as const, usedRecoveryCode: !!r.usedRecoveryCode };
    },
    [],
  );

  const signUp = React.useCallback(
    async (email: string, password: string, firstName: string, lastName: string, referralCode?: string) => {
      const r = await api.auth.register({ email, password, firstName, lastName, role: 'BUYER', referralCode });
      setAccessToken(r.accessToken);
      setUser(r.user);
    },
    [],
  );

  const signOut = React.useCallback(async () => {
    try {
      await api.auth.logout();
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const value: AuthContextValue = { user, loading, signIn, verifyTwoFactor, signUp, signOut, refresh };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
