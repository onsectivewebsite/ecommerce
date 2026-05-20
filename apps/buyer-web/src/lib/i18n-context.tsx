'use client';

import * as React from 'react';
import {
  LOCALE_DIRECTION,
  LOCALE_DISPLAY,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  makeTranslator,
  type SupportedLocale,
} from '@onsective/i18n';
import { api } from './api';
import { useAuth } from './auth-context';

interface I18nContextValue {
  locale: SupportedLocale;
  currency: string;
  setLocale(l: SupportedLocale): void;
  setCurrency(c: string): void;
  t(key: string, vars?: Record<string, string | number>): string;
  supported: { locales: typeof SUPPORTED_LOCALES; display: typeof LOCALE_DISPLAY };
}

const I18nContext = React.createContext<I18nContextValue | null>(null);

const LOCALE_COOKIE = 'onsective_locale';
const CURRENCY_COOKIE = 'onsective_currency';

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=')[1]) : null;
}

function writeCookie(name: string, value: string) {
  if (typeof document === 'undefined') return;
  const exp = new Date(Date.now() + 365 * 86400_000);
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${exp.toUTCString()}; path=/; SameSite=Lax`;
}

function detectInitialLocale(): SupportedLocale {
  const fromCookie = readCookie(LOCALE_COOKIE);
  if (fromCookie && isSupportedLocale(fromCookie)) return fromCookie;
  if (typeof navigator !== 'undefined') {
    const browser = (navigator.language ?? 'en').split('-')[0];
    if (isSupportedLocale(browser)) return browser;
  }
  return 'en';
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [locale, setLocaleState] = React.useState<SupportedLocale>('en');
  const [currency, setCurrencyState] = React.useState<string>('USD');
  const [hydrated, setHydrated] = React.useState(false);

  // Initial detection from cookies / browser
  React.useEffect(() => {
    setLocaleState(detectInitialLocale());
    const cur = readCookie(CURRENCY_COOKIE);
    if (cur) setCurrencyState(cur.toUpperCase());
    setHydrated(true);
  }, []);

  // Once authenticated, pull persisted preferences (user wins over cookie).
  React.useEffect(() => {
    if (!user) return;
    api.users.getPreferences().then((p) => {
      if (isSupportedLocale(p.locale)) setLocaleState(p.locale);
      if (p.currency) setCurrencyState(p.currency.toUpperCase());
    }).catch(() => undefined);
  }, [user]);

  // Reflect locale into <html dir lang>
  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = locale;
    document.documentElement.dir = LOCALE_DIRECTION[locale];
  }, [locale]);

  const setLocale = React.useCallback((l: SupportedLocale) => {
    setLocaleState(l);
    writeCookie(LOCALE_COOKIE, l);
    if (user) api.users.updatePreferences({ locale: l }).catch(() => undefined);
  }, [user]);

  const setCurrency = React.useCallback((c: string) => {
    const upper = c.toUpperCase();
    setCurrencyState(upper);
    writeCookie(CURRENCY_COOKIE, upper);
    if (user) api.users.updatePreferences({ currency: upper }).catch(() => undefined);
  }, [user]);

  const t = React.useMemo(() => makeTranslator(locale), [locale]);

  const value: I18nContextValue = {
    locale, currency, setLocale, setCurrency, t,
    supported: { locales: SUPPORTED_LOCALES, display: LOCALE_DISPLAY },
  };

  // Always wrap children so consumers get a real translator even during SSR.
  // Until `hydrated` flips true the locale is 'en' (the SSR-safe default).
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = React.useContext(I18nContext);
  if (!ctx) {
    // Safe-fallback when a component renders outside <I18nProvider> — we still
    // return a working English translator so the UI never shows raw keys.
    return {
      locale: 'en',
      currency: 'USD',
      setLocale: () => undefined,
      setCurrency: () => undefined,
      t: makeTranslator('en'),
      supported: { locales: SUPPORTED_LOCALES, display: LOCALE_DISPLAY },
    };
  }
  return ctx;
}
