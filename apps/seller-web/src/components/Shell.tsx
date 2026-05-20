'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ConnectStatus } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/products', label: 'Products' },
  { href: '/products/bulk', label: 'Bulk import' },
  { href: '/orders', label: 'Orders' },
  { href: '/returns', label: 'Returns' },
  { href: '/reviews', label: 'Reviews' },
  { href: '/messages', label: 'Messages' },
  { href: '/promotions', label: 'Promotions' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/inventory/alerts', label: 'Low stock' },
  { href: '/webhooks', label: 'Webhooks' },
  { href: '/health', label: 'Health' },
  { href: '/fulfillment/inbound', label: 'Fulfillment' },
  { href: '/certifications', label: 'Certifications' },
  { href: '/refurb-units', label: 'Refurb units' },
  { href: '/ads', label: 'Ads' },
  { href: '/payouts', label: 'Payouts' },
  { href: '/compliance', label: 'Compliance' },
  { href: '/subscription', label: 'Plan' },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const [connect, setConnect] = React.useState<ConnectStatus | null>(null);

  React.useEffect(() => {
    if (!user) { setConnect(null); return; }
    let cancelled = false;
    api.onboarding.status()
      .then((s) => { if (!cancelled) setConnect(s); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [user, pathname]);

  const showPayoutBanner = user && connect && !connect.payoutsEnabled
    && connect.status !== 'DISABLED' && pathname !== '/seller/onboarding/payouts';

  return (
    <div className="min-h-screen flex flex-col">
      {showPayoutBanner && (
        <div className="bg-warning/10 border-b border-warning/30 text-warning text-xs">
          <div className="container py-2 flex items-center justify-between gap-3">
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
      <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-950/85 backdrop-blur-md">
        <div className="container flex h-16 items-center gap-6">
          <Link href="/" className="flex items-baseline gap-1.5">
            <span className="text-lg font-display font-semibold tracking-tight">Onsective</span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-accent-300">Seller</span>
          </Link>
          <nav className="flex-1 flex items-center gap-1 text-sm">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={[
                  'rounded-lg px-3 py-2 transition-colors',
                  pathname === n.href ? 'text-ink-50 bg-ink-800' : 'text-ink-300 hover:text-ink-50 hover:bg-ink-800/60',
                ].join(' ')}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2 text-sm">
            {user ? (
              <>
                <span className="text-ink-300">{user.email}</span>
                <button onClick={() => signOut()} className="ons-btn-ghost">Sign out</button>
              </>
            ) : (
              <Link href="/login" className="ons-btn-primary">Sign in</Link>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
