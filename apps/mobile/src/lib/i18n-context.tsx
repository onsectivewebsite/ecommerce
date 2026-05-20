import React from 'react';
import { NativeModules, Platform } from 'react-native';
import { isSupportedLocale, makeTranslator, SUPPORTED_LOCALES, type SupportedLocale } from '@onsective/i18n';
import { api } from './api';
import { useAuth } from './auth-context';

interface I18nValue {
  locale: SupportedLocale;
  currency: string;
  setLocale(l: SupportedLocale): void;
  setCurrency(c: string): void;
  t(key: string, vars?: Record<string, string | number>): string;
}

const I18nContext = React.createContext<I18nValue | null>(null);

function detectInitialLocale(): SupportedLocale {
  // No external i18n dep — read the platform locale off the React Native bridge
  // directly. Format varies by platform; we only need the leading ISO-639 part.
  let raw: string | undefined;
  if (Platform.OS === 'ios') {
    raw =
      (NativeModules.SettingsManager?.settings?.AppleLocale as string | undefined) ??
      (NativeModules.SettingsManager?.settings?.AppleLanguages?.[0] as string | undefined);
  } else if (Platform.OS === 'android') {
    raw = NativeModules.I18nManager?.localeIdentifier as string | undefined;
  }
  const tag = (raw ?? 'en').toLowerCase().split(/[-_]/)[0];
  return isSupportedLocale(tag) ? tag : 'en';
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [locale, setLocaleState] = React.useState<SupportedLocale>(() => detectInitialLocale());
  const [currency, setCurrencyState] = React.useState<string>('USD');

  React.useEffect(() => {
    if (!user) return;
    api.users.getPreferences().then((p) => {
      if (isSupportedLocale(p.locale)) setLocaleState(p.locale);
      if (p.currency) setCurrencyState(p.currency.toUpperCase());
    }).catch(() => undefined);
  }, [user]);

  const setLocale = React.useCallback((l: SupportedLocale) => {
    setLocaleState(l);
    if (user) api.users.updatePreferences({ locale: l }).catch(() => undefined);
  }, [user]);

  const setCurrency = React.useCallback((c: string) => {
    const upper = c.toUpperCase();
    setCurrencyState(upper);
    if (user) api.users.updatePreferences({ currency: upper }).catch(() => undefined);
  }, [user]);

  const t = React.useMemo(() => makeTranslator(locale), [locale]);

  return (
    <I18nContext.Provider value={{ locale, currency, setLocale, setCurrency, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nValue {
  const ctx = React.useContext(I18nContext);
  if (!ctx) {
    return {
      locale: 'en',
      currency: 'USD',
      setLocale: () => undefined,
      setCurrency: () => undefined,
      t: makeTranslator('en'),
    };
  }
  return ctx;
}

export { SUPPORTED_LOCALES };
