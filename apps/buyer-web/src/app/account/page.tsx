'use client';

import Link from 'next/link';
import { Card, CardDescription, CardTitle } from '@onsective/ui';
import { useAuth } from '@/lib/auth-context';

export default function AccountPage() {
  const { user, signOut, loading } = useAuth();
  if (loading) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!user) return <div className="container py-16"><Link href="/login" className="ons-btn-primary">Sign in</Link></div>;
  return (
    <div className="container py-10 max-w-3xl">
      <h1 className="font-display text-3xl tracking-tight mb-6">Account</h1>
      <Card>
        <CardTitle>{user.firstName} {user.lastName}</CardTitle>
        <CardDescription>{user.email} · {user.role}</CardDescription>
        <div className="mt-6 grid grid-cols-2 md:grid-cols-3 gap-3">
          <Link href="/account/inbox" className="ons-btn-secondary">Inbox</Link>
          <Link href="/orders" className="ons-btn-secondary">Orders</Link>
          <Link href="/account/returns" className="ons-btn-secondary">Returns</Link>
          <Link href="/account/wishlist" className="ons-btn-secondary">Wishlist</Link>
          <Link href="/account/wallet" className="ons-btn-secondary">Wallet</Link>
          <Link href="/account/payment-methods" className="ons-btn-secondary">Payment methods</Link>
          <Link href="/account/membership" className="ons-btn-secondary">Membership</Link>
          <Link href="/account/points" className="ons-btn-secondary">Points</Link>
          <Link href="/account/referrals" className="ons-btn-secondary">Refer friends</Link>
          <Link href="/account/privacy" className="ons-btn-secondary">Privacy</Link>
          <Link href="/account/downloads" className="ons-btn-secondary">Digital downloads</Link>
          <Link href="/account/preferences" className="ons-btn-secondary">Notifications</Link>
          <Link href="/account/security" className="ons-btn-secondary">Security activity</Link>
          <Link href="/checkout" className="ons-btn-secondary">Saved addresses</Link>
          <button onClick={() => signOut()} className="ons-btn-ghost text-danger">Sign out</button>
        </div>
      </Card>
    </div>
  );
}
