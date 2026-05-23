'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCart } from '@/lib/cart-context';
import { useAuth } from '@/lib/auth-context';
import { useI18n } from '@/lib/i18n-context';
import { api } from '@/lib/api';
import type { SupportedLocale } from '@onsective/i18n';

const CURRENCIES = ['USD','EUR','GBP','INR','CAD','AUD','JPY','CNY','RUB','PKR','BDT','VND'];

export function TopBar() {
  const { user, signOut } = useAuth();
  const { cart } = useCart();
  const { locale, currency, setLocale, setCurrency, t, supported } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initial = searchParams.get('query') ?? '';
  const [isPlus, setIsPlus] = React.useState(false);
  const [unread, setUnread] = React.useState(0);

  React.useEffect(() => {
    if (!user) { setUnread(0); return; }
    let cancelled = false;
    const fetchCount = () => {
      api.inbox.unreadCount()
        .then((r) => { if (!cancelled) setUnread(r.count); })
        .catch(() => undefined);
    };
    fetchCount();
    const id = setInterval(fetchCount, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [user]);

  React.useEffect(() => {
    if (!user) { setIsPlus(false); return; }
    let cancelled = false;
    api.loyalty.myMembership()
      .then((r) => {
        if (cancelled) return;
        const m = r.membership;
        setIsPlus(
          !!m && m.status === 'ACTIVE' && new Date(m.expiresAt).getTime() > Date.now(),
        );
      })
      .catch(() => setIsPlus(false));
    return () => { cancelled = true; };
  }, [user]);

  function handleSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const q = String(data.get('query') ?? '').trim();
    if (q) router.push(`/search?query=${encodeURIComponent(q)}`);
  }

  const itemCount = cart?.itemCount ?? 0;
  const deletionPending = user?.deletionStatus === 'REQUESTED' && user.deletionScheduledFor;

  return (
    <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-950/90 backdrop-blur-md">
      {deletionPending && (
        <div className="bg-warning/10 border-b border-warning/30 text-warning text-xs">
          <div className="container py-2 flex items-center justify-between gap-3">
            <span>
              Your account is scheduled for deletion on{' '}
              {new Date(user!.deletionScheduledFor!).toLocaleDateString()}.
            </span>
            <Link href="/account/privacy" className="underline whitespace-nowrap">
              Cancel deletion
            </Link>
          </div>
        </div>
      )}

      {/* Primary row: logo · search · account/cart */}
      <div className="container flex h-16 items-center gap-4 md:gap-6">
        <Link href="/" className="shrink-0 text-lg md:text-xl font-display font-semibold tracking-tight text-ink-50">
          Onsective
        </Link>

        <form onSubmit={handleSearch} className="flex-1 max-w-3xl">
          <div className="relative">
            <input
              name="query"
              defaultValue={initial}
              placeholder={t('nav.searchPlaceholder')}
              className="ons-input pr-12"
              aria-label={t('nav.search')}
            />
            <button
              type="submit"
              aria-label={t('nav.search')}
              className="absolute right-1 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg bg-accent-500 hover:bg-accent-400 text-white text-sm"
            >
              🔍
            </button>
          </div>
        </form>

        <nav className="flex items-center gap-1 text-sm shrink-0">
          {user ? (
            <>
              <Link
                href="/account/inbox"
                aria-label={t('nav.inbox')}
                className="ons-btn-ghost relative"
              >
                <span aria-hidden="true">🔔</span>
                {unread > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center text-[10px] font-semibold rounded-full bg-accent-500 text-white h-4 min-w-4 px-1">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </Link>
              <Link href="/account" className="ons-btn-ghost flex items-center gap-1.5">
                {user.firstName}
                {isPlus && (
                  <span
                    title="Onsective Plus member"
                    className="inline-flex items-center text-[10px] font-semibold uppercase tracking-wider rounded-md bg-gold-500/15 text-gold-300 border border-gold-400/30 px-1.5 py-0.5"
                  >
                    Plus
                  </span>
                )}
              </Link>
              <button onClick={() => signOut()} className="ons-btn-ghost hidden md:inline-flex">{t('nav.signOut')}</button>
            </>
          ) : (
            <>
              <Link href="/login" className="ons-btn-ghost">{t('nav.signIn')}</Link>
              <Link href="/register" className="ons-btn-primary hidden md:inline-flex">{t('nav.signUp')}</Link>
            </>
          )}
          <Link href="/cart" className="ons-btn-ghost relative ml-1">
            🛒 <span className="hidden md:inline">{t('nav.cart')}</span>
            {itemCount > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center text-[10px] font-semibold rounded-full bg-accent-500 text-white h-5 min-w-5 px-1.5">
                {itemCount}
              </span>
            )}
          </Link>
        </nav>
      </div>

      {/* Secondary row: category / utility links + locale + currency */}
      <div className="border-t border-ink-800/60 bg-ink-950/70">
        <div className="container h-10 flex items-center justify-between gap-2 text-xs overflow-x-auto">
          <nav className="flex items-center gap-1 text-ink-300 shrink-0">
            <Link href="/search" className="ons-btn-ghost text-xs">{t('nav.allProducts')}</Link>
            <Link href="/collections" className="ons-btn-ghost text-xs">{t('nav.collections')}</Link>
            <Link href="/outlet" className="ons-btn-ghost text-xs">{t('nav.outlet')}</Link>
            <Link href="/compare" className="ons-btn-ghost text-xs">{t('nav.compare')}</Link>
            <Link href="/gift-cards" className="ons-btn-ghost text-xs">{t('nav.giftCards')}</Link>
            <Link href="/trade-in" className="ons-btn-ghost text-xs hidden md:inline-flex">{t('nav.tradeIn')}</Link>
          </nav>
          <div className="flex items-center gap-1 shrink-0">
            <select
              aria-label={t('locale.label')}
              value={locale}
              onChange={(e) => setLocale(e.target.value as SupportedLocale)}
              className="bg-ink-900 border border-ink-800 rounded-md text-xs text-ink-200 h-7 px-1.5"
            >
              {supported.locales.map((l) => (
                <option key={l} value={l} className="bg-ink-900">{supported.display[l]}</option>
              ))}
            </select>
            <select
              aria-label={t('currency.label')}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="bg-ink-900 border border-ink-800 rounded-md text-xs text-ink-200 h-7 px-1.5"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c} className="bg-ink-900">{c}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </header>
  );
}
