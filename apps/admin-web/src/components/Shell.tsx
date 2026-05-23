'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

const NAV: Array<{ section?: string; href: string; label: string }> = [
  { section: 'Operations', href: '/', label: 'Overview' },
  { href: '/orders', label: 'Orders' },
  { href: '/shipping', label: 'Shipping' },
  { href: '/returns', label: 'Returns' },
  { href: '/disputes', label: 'Disputes' },
  { href: '/support', label: 'Support' },

  { section: 'Catalog', href: '/sellers', label: 'Sellers' },
  { href: '/brands', label: 'Brands' },
  { href: '/collections', label: 'Collections' },
  { href: '/certifications', label: 'Certifications' },
  { href: '/authenticity', label: 'Authenticity' },
  { href: '/warranty', label: 'Warranty' },
  { href: '/trade-in', label: 'Trade-in' },
  { href: '/refurb-units' as unknown as string, label: 'Refurb units' },
  { href: '/dispositions', label: 'Dispositions' },
  { href: '/repair-network', label: 'Repair' },
  { href: '/ai-vision', label: 'AI vision' },

  { section: 'Community', href: '/reviews', label: 'Reviews' },
  { href: '/qna', label: 'Q&A' },
  { href: '/announcements', label: 'Announcements' },

  { section: 'Marketing', href: '/promotions', label: 'Promotions' },
  { href: '/referrals', label: 'Referrals' },
  { href: '/gift-cards', label: 'Gift cards' },
  { href: '/plus', label: 'Plus' },

  { section: 'Finance', href: '/revenue', label: 'Revenue' },
  { href: '/payouts', label: 'Payouts' },
  { href: '/wallet', label: 'Wallet' },
  { href: '/listing-fees', label: 'Listing fees' },

  { section: 'Trust & risk', href: '/risk', label: 'Risk' },
  { href: '/rate-limits', label: 'Rate limits' },
  { href: '/security', label: 'Security' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/compliance', label: 'Compliance' },
  { href: '/seller-health', label: 'Health' },
  { href: '/sla', label: 'SLA' },

  { section: 'Infra', href: '/warehouses', label: 'Warehouses' },
  { href: '/sustainability', label: 'Sustainability' },
  { href: '/audit-log', label: 'Audit log' },
  { href: '/settings', label: 'Settings' },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => { setMobileOpen(false); }, [pathname]);

  return (
    <div className="min-h-screen flex flex-col">
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
            <span className="text-[10px] uppercase tracking-[0.18em] text-gold-400">Admin</span>
          </Link>
          {user && <button onClick={() => signOut()} className="ons-btn-ghost text-xs">Sign out</button>}
        </div>
      </header>

      {/* Sidebar */}
      <aside
        className={[
          'fixed inset-y-0 left-0 z-30 w-64 bg-ink-950 border-r border-ink-800 flex flex-col',
          'transition-transform duration-200 lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        ].join(' ')}
      >
        <div className="h-16 border-b border-ink-800 flex items-center px-5 gap-1.5 shrink-0">
          <Link href="/" className="flex items-baseline gap-1.5">
            <span className="text-lg font-display font-semibold tracking-tight">Onsective</span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-gold-400">Admin</span>
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
                    ? 'text-ink-50 bg-ink-800 border-l-2 border-gold-400'
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

      {mobileOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-20 bg-black/60 lg:hidden"
        />
      )}

      <main className="flex-1 lg:pl-64">{children}</main>
    </div>
  );
}
