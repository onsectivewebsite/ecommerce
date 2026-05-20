'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

const NAV = [
  { href: '/', label: 'Pickup queue' },
  { href: '/shipments', label: 'All shipments' },
  { href: '/pick-list', label: 'Pick list' },
  { href: '/trade-in', label: 'Trade-in intake' },
  { href: '/returns', label: 'Returns intake' },
  { href: '/repair', label: 'Repair queue' },
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
            <span className="text-[10px] uppercase tracking-[0.18em] text-accent-300">Shipping</span>
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
