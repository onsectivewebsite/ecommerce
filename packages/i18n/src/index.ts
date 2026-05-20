import en from './locales/en.json';
import hi from './locales/hi.json';
import fr from './locales/fr.json';
import ja from './locales/ja.json';
import zh from './locales/zh.json';
import ur from './locales/ur.json';
import bn from './locales/bn.json';
import vi from './locales/vi.json';
import ru from './locales/ru.json';

export const SUPPORTED_LOCALES = ['en', 'hi', 'fr', 'ja', 'zh', 'ur', 'bn', 'vi', 'ru'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export type Catalog = Record<string, string | Record<string, string>>;

export const LOCALE_CATALOGS: Record<SupportedLocale, Catalog> = {
  en, hi, fr, ja, zh, ur, bn, vi, ru,
};

export const LOCALE_DIRECTION: Record<SupportedLocale, 'ltr' | 'rtl'> = {
  en: 'ltr', hi: 'ltr', fr: 'ltr', ja: 'ltr', zh: 'ltr', ur: 'rtl', bn: 'ltr', vi: 'ltr', ru: 'ltr',
};

export const LOCALE_DISPLAY: Record<SupportedLocale, string> = {
  en: 'English',
  hi: 'हिन्दी',
  fr: 'Français',
  ja: '日本語',
  zh: '中文',
  ur: 'اُردُو',
  bn: 'বাংলা',
  vi: 'Tiếng Việt',
  ru: 'Русский',
};

export function isSupportedLocale(v: string | null | undefined): v is SupportedLocale {
  return !!v && (SUPPORTED_LOCALES as readonly string[]).includes(v);
}

/**
 * Resolve a dotted path into the catalog. Returns the raw string, or the key itself
 * as a visible-fallback when the path is missing — so missing translations are obvious
 * in dev without crashing the page.
 */
export function translate(locale: SupportedLocale, key: string, vars?: Record<string, string | number>): string {
  const catalog = LOCALE_CATALOGS[locale] ?? LOCALE_CATALOGS.en;
  const parts = key.split('.');
  let cursor: any = catalog;
  for (const p of parts) {
    if (cursor && typeof cursor === 'object' && p in cursor) cursor = cursor[p];
    else { cursor = undefined; break; }
  }
  if (typeof cursor !== 'string') {
    // Fall back to English before showing the raw key.
    let fb: any = LOCALE_CATALOGS.en;
    for (const p of parts) {
      if (fb && typeof fb === 'object' && p in fb) fb = fb[p];
      else { fb = undefined; break; }
    }
    cursor = typeof fb === 'string' ? fb : `[[${key}]]`;
  }
  if (!vars) return cursor;
  return cursor.replace(/\{(\w+)\}/g, (_: string, name: string) => String(vars[name] ?? `{${name}}`));
}

export function makeTranslator(locale: SupportedLocale) {
  return (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);
}
