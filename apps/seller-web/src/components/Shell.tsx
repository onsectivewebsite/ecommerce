'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ConnectStatus } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const NAV: Array<{ section?: string; href: string; label: string }> = [
  { section: 'Overview', href: '/', label: 'Dashboard' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/health', label: 'Health' },

  { section: 'Catalog', href: '/products', label: 'Products' },
  { href: '/listings', label: 'Listings' },
  { href: '/products/bulk', label: 'Bulk import' },
  { href: '/inventory/alerts', label: 'Low stock' },
  { href: '/refurb-units', label: 'Refurb units' },
  { href: '/certifications', label: 'Certifications' },

  { section: 'Orders', href: '/orders', label: 'Orders' },
  { href: '/returns', label: 'Returns' },
  { href: '/fulfillment/inbound', label: 'Fulfillment' },

  { section: 'Customers', href: '/reviews', label: 'Reviews' },
  { href: '/qna', label: 'Q&A' },
  { href: '/messages', label: 'Messages' },

  { section: 'Marketing', href: '/promotions', label: 'Promotions' },
  { href: '/ads', label: 'Ads' },

  { section: 'Finance', href: '/payouts', label: 'Payouts' },
  { href: '/subscription', label: 'Plan' },

  { section: 'Settings', href: '/compliance', label: 'Compliance' },
  { href: '/webhooks', label: 'Webhooks' },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const [connect, setConnect] = React.useState<ConnectStatus | null>(null);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    if (!user) { setConnect(null); return; }
    let cancelled = false;
    api.onboarding.status()
      .then((s) => { if (!cancelled) setConnect(s); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [user, pathname]);

  // Close mobile drawer on navigation.
  React.useEffect(() => { setMobileOpen(false); }, [pathname]);

  const showPayoutBanner = user && connect && !connect.payoutsEnabled
    && connect.status !== 'DISABLED' && pathname !== '/seller/onboarding/payouts';

  return (
    <div className="min-h-screen flex flex-col">
      {showPayoutBanner && (
        <div className="bg-warning/10 border-b border-warning/30 text-warning text-xs">
          <div className="px-4 lg:pl-64 py-2 flex items-center justify-between gap-3">
            <span>
              Your payouts {connect!.status === 'NOT_STARTED' ? "aren't set up" : 'need attention'}.
              {' '}Without this, sale funds stay on the platform until resolved.
            </span>
            <Link href="/seller/onboarding/payouts" className="underline whitespace-nowrap">
              {connect!.status === 'NOT_STARTED' ? 'Set up payouts' : 'Continue setup'}
            </Link>
          </div>
        </div>
      )}

      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-40 border-b border-ink-800 bg-ink-950/95 backdrop-blur-md">
        <div className="flex h-14 items-center justify-between px-4 gap-3">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setMobileOpen((v) => !v)}
            className="ons-btn-ghost text-lg"
          >
            ☰
          </button>
          <Link href="/" className="flex items-baseline gap-1.5">
            <span className="text-base font-display font-semibold tracking-tight">Onsective</span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-accent-300">Seller</span>
          </Link>
          {user ? (
            <button onClick={() => signOut()} className="ons-btn-ghost text-xs">Sign out</button>
          ) : (
            <Link href="/login" className="ons-btn-primary text-xs">Sign in</Link>
          )}
        </div>
      </header>

      {/* Sidebar (fixed on desktop, drawer on mobile) */}
      <aside
        className={[
          'fixed inset-y-0 left-0 z-30 w-60 bg-ink-950 border-r border-ink-800 flex flex-col',
          'transition-transform duration-200 lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        ].join(' ')}
      >
        <div className="h-16 border-b border-ink-800 flex items-center px-5 gap-1.5 shrink-0">
          <Link href="/" className="flex items-baseline gap-1.5">
            <span className="text-lg font-display font-semibold tracking-tight">Onsective</span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-accent-300">Seller</span>
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4 text-sm space-y-0.5">
          {NAV.map((n) => (
            <React.Fragment key={n.href}>
              {n.section && (
                <div className="mt-4 first:mt-0 mb-1 px-2 text-[10px] uppercase tracking-[0.18em] text-ink-500">
                  {n.section}
                </div>
              )}
              <Link
                href={n.href}
                className={[
                  'block rounded-md px-2.5 py-1.5 transition-colors',
                  pathname === n.href
                    ? 'text-ink-50 bg-ink-800 border-l-2 border-accent-500'
                    : 'text-ink-300 hover:text-ink-50 hover:bg-ink-800/60',
                ].join(' ')}
              >
                {n.label}
              </Link>
            </React.Fragment>
          ))}
        </nav>
        {user && (
          <div className="border-t border-ink-800 px-4 py-3 text-xs text-ink-400 hidden lg:flex items-center justify-between gap-2">
            <span className="truncate">{user.email}</span>
            <button onClick={() => signOut()} className="text-ink-300 hover:text-ink-50 whitespace-nowrap">
              Sign out
            </button>
          </div>
        )}
      </aside>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-20 bg-black/60 lg:hidden"
        />
      )}

      <main className="flex-1 lg:pl-60">{children}</main>
    </div>
  );
}
