'use client';

import * as React from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { AuthUser, LoginResponse } from '@onsective/shared-types';
import { api, setAccessToken } from './api';

type SignInResult = { ok: true } | { mfaRequired: true; challenge: string };

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  signIn(email: string, password: string): Promise<SignInResult>;
  verifyTwoFactor(challenge: string, code: string): Promise<{ ok: true }>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
}

function isMfaChallenge(r: LoginResponse): r is { mfaRequired: true; challenge: string } {
  return (r as { mfaRequired?: boolean }).mfaRequired === true;
}
const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [loading, setLoading] = React.useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const refresh = React.useCallback(async () => {
    try {
      const r = await api.auth.refresh();
      setAccessToken(r.accessToken);
      setUser(r.user);
    } catch {
      setAccessToken(null);
      setUser(null);
    } finally { setLoading(false); }
  }, []);

  React.useEffect(() => { refresh(); }, [refresh]);

  React.useEffect(() => {
    if (loading) return;
    if (!user && pathname !== '/login') router.push('/login');
    if (user && user.role !== 'ADMIN' && pathname !== '/login') {
      router.push('/login?denied=1');
    }
  }, [user, loading, pathname, router]);

  return (
    <AuthContext.Provider
      value={{
        user, loading, refresh,
        async signIn(email, password): Promise<SignInResult> {
          const r = await api.auth.login({ email, password });
          if (isMfaChallenge(r)) return { mfaRequired: true, challenge: r.challenge };
          if (r.user.role !== 'ADMIN') throw new Error('Not an admin account');
          setAccessToken(r.accessToken);
          setUser(r.user);
          return { ok: true };
        },
        async verifyTwoFactor(challenge, code) {
          const r = await api.auth.twoFactorVerifyLogin(challenge, code);
          if (r.user.role !== 'ADMIN') {
            // Wipe tokens we may have received — non-admin should not get into
            // admin-web even after a successful 2FA verify.
            setAccessToken(null);
            await api.auth.logout().catch(() => undefined);
            throw new Error('Not an admin account');
          }
          setAccessToken(r.accessToken);
          setUser(r.user);
          return { ok: true };
        },
        async signOut() {
          try { await api.auth.logout(); } finally {
            setAccessToken(null);
            setUser(null);
            router.push('/login');
          }
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
