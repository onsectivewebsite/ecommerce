import React from 'react';
import * as SecureStore from 'expo-secure-store';
import type { AuthUser } from '@onsective/shared-types';
import { api, loadStoredTokens, setAccessToken, setRefreshToken } from './api';

const REFRESH_KEY = 'onsective_refresh_token';

interface AuthValue {
  user: AuthUser | null;
  loading: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, firstName: string, lastName: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = React.createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadStoredTokens();
      try {
        const me = await api.auth.me();
        if (!cancelled) setUser(me ?? null);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const signIn = React.useCallback(async (email: string, password: string) => {
    const r = await api.auth.login({ email, password });
    // Phase 31: the mobile app does not yet have a 2FA verification screen.
    // If the account has 2FA enabled, ask the user to use the web portal until
    // mobile parity ships. (Tracked as a Phase 32+ follow-on.)
    if ('mfaRequired' in r) {
      throw new Error(
        'Two-factor sign-in is required on this account. Please sign in on the web for now.',
      );
    }
    await setAccessToken(r.accessToken);
    if (r.refreshToken) await setRefreshToken(r.refreshToken);
    setUser(r.user);
  }, []);

  const signUp = React.useCallback(async (email: string, password: string, firstName: string, lastName: string) => {
    const r = await api.auth.register({ email, password, firstName, lastName, role: 'BUYER' });
    await setAccessToken(r.accessToken);
    if (r.refreshToken) await setRefreshToken(r.refreshToken);
    setUser(r.user);
  }, []);

  const signOut = React.useCallback(async () => {
    // Send the stored refresh token so the backend can revoke it server-side.
    let refresh: string | null = null;
    try { refresh = await SecureStore.getItemAsync(REFRESH_KEY); } catch { /* missing */ }
    try { await api.auth.logout(refresh ? { refreshToken: refresh } : undefined); } catch { /* offline */ }
    await setAccessToken(null);
    await setRefreshToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
