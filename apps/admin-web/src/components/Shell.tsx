'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

const NAV = [
  { href: '/', label: 'Overview' },
  { href: '/sellers', label: 'Sellers' },
  { href: '/orders', label: 'Orders' },
  { href: '/shipping', label: 'Shipping' },
  { href: '/returns', label: 'Returns' },
  { href: '/reviews', label: 'Reviews' },
  { href: '/qna', label: 'Q&A' },
  { href: '/disputes', label: 'Disputes' },
  { href: '/support', label: 'Support' },
  { href: '/promotions', label: 'Promotions' },
  { href: '/wallet', label: 'Wallet' },
  { href: '/gift-cards', label: 'Gift cards' },
  { href: '/risk', label: 'Risk' },
  { href: '/seller-health', label: 'Health' },
  { href: '/warehouses', label: 'Warehouses' },
  { href: '/brands', label: 'Brands' },
  { href: '/certifications', label: 'Certifications' },
  { href: '/authenticity', label: 'Authenticity' },
  { href: '/warranty', label: 'Warranty' },
  { href: '/trade-in', label: 'Trade-in' },
  { href: '/ai-vision', label: 'AI vision' },
  { href: '/dispositions', label: 'Dispositions' },
  { href: '/repair-network', label: 'Repair' },
  { href: '/sustainability', label: 'Sustainability' },
  { href: '/sla', label: 'SLA' },
  { href: '/plus', label: 'Plus' },
  { href: '/referrals', label: 'Referrals' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/rate-limits', label: 'Rate limits' },
  { href: '/security', label: 'Security' },
  { href: '/revenue', label: 'Revenue' },
  { href: '/payouts', label: 'Payouts' },
  { href: '/compliance', label: 'Compliance' },
  { href: '/listing-fees', label: 'Listing fees' },
  { href: '/audit-log', label: 'Audit log' },
  { href: '/settings', label: 'Settings' },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-950/85 backdrop-blur-md">
        <div className="container flex h-16 items-center gap-6">
          <Link href="/" className="flex items-baseline gap-1.5">
            <span className="text-lg font-display font-semibold tracking-tight">Onsective</span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-gold-400">Admin</span>
          </Link>
          <nav className="flex-1 flex items-center gap-1 text-sm">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={[
                'rounded-lg px-3 py-2 transition-colors',
                pathname === n.href ? 'text-ink-50 bg-ink-800' : 'text-ink-300 hover:text-ink-50 hover:bg-ink-800/60',
              ].join(' ')}>{n.label}</Link>
            ))}
          </nav>
          <div className="text-sm flex items-center gap-2">
            {user && <span className="text-ink-300">{user.email}</span>}
            {user && <button onClick={() => signOut()} className="ons-btn-ghost">Sign out</button>}
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
