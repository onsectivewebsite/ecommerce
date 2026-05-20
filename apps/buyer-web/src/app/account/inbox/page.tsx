'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { NotificationKind, NotificationRow } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const KIND_LABEL: Record<NotificationKind, string> = {
  PLUS_RENEWED: 'Plus',
  PLUS_PAYMENT_FAILED: 'Plus',
  PLUS_EXPIRING_SOON: 'Plus',
  PLUS_EXPIRED: 'Plus',
  REFERRAL_REDEEMED: 'Referrals',
  ORDER_PAID: 'Order',
  ORDER_SHIPPED: 'Order',
  ORDER_DELIVERED: 'Order',
  MESSAGE_NEW: 'Message',
  REVIEW_POSTED: 'Review',
  SECURITY_SIGN_IN: 'Security',
  GENERIC: 'Notice',
};

const KIND_TONE: Record<NotificationKind, string> = {
  PLUS_RENEWED: 'text-success',
  PLUS_PAYMENT_FAILED: 'text-danger',
  PLUS_EXPIRING_SOON: 'text-warning',
  PLUS_EXPIRED: 'text-ink-400',
  REFERRAL_REDEEMED: 'text-gold-300',
  ORDER_PAID: 'text-accent-300',
  ORDER_SHIPPED: 'text-accent-300',
  ORDER_DELIVERED: 'text-success',
  MESSAGE_NEW: 'text-accent-300',
  REVIEW_POSTED: 'text-ink-300',
  SECURITY_SIGN_IN: 'text-warning',
  GENERIC: 'text-ink-300',
};

export default function InboxPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [rows, setRows] = React.useState<NotificationRow[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [hasMore, setHasMore] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = React.useState(false);

  const reset = React.useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.inbox.list({ limit: 50, unreadOnly });
      setRows(r.rows);
      setCursor(r.nextCursor);
      setHasMore(!!r.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }, [unreadOnly]);

  React.useEffect(() => {
    if (loading || !user) return;
    void reset();
  }, [loading, user, reset]);

  async function loadMore() {
    if (!cursor || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await api.inbox.list({ cursor, limit: 50, unreadOnly });
      setRows((prev) => [...prev, ...r.rows]);
      setCursor(r.nextCursor);
      setHasMore(!!r.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  async function open(row: NotificationRow) {
    if (!row.readAt) {
      try { await api.inbox.markRead(row.id); } catch { /* ignore */ }
      setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, readAt: new Date().toISOString() } : r));
    }
    if (row.deepLinkPath) router.push(row.deepLinkPath);
  }

  async function markAllRead() {
    try {
      await api.inbox.markAllRead();
      setRows((prev) => prev.map((r) => r.readAt ? r : { ...r, readAt: new Date().toISOString() }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (loading) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!user) {
    return (
      <div className="container py-16">
        <Link href="/login?next=/account/inbox" className="ons-btn-primary">Sign in</Link>
      </div>
    );
  }

  const unreadCount = rows.filter((r) => !r.readAt).length;

  return (
    <div className="container py-10 max-w-3xl space-y-6">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Inbox</h1>
          <p className="text-ink-300 text-sm mt-1">
            Everything that needs your attention, in one place.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-ink-300 flex items-center gap-1">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
            />
            Unread only
          </label>
          <button
            onClick={markAllRead}
            disabled={unreadCount === 0}
            className="ons-btn-ghost text-xs"
          >
            Mark all read
          </button>
        </div>
      </header>

      {error && <div className="ons-card border-danger/40 text-danger">{error}</div>}

      {rows.length === 0 ? (
        <div className="ons-card text-ink-400 text-sm">
          {unreadOnly ? 'No unread notifications.' : "You're all caught up — nothing here yet."}
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                onClick={() => open(row)}
                className={[
                  'w-full text-left ons-card flex items-start gap-3 hover:border-accent-500/40 transition-colors',
                  row.readAt ? 'opacity-70' : '',
                ].join(' ')}
              >
                <span className={`inline-block mt-1 w-2 h-2 rounded-full ${row.readAt ? 'bg-ink-700' : 'bg-accent-400'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] uppercase tracking-[0.18em] ${KIND_TONE[row.kind]}`}>
                      {KIND_LABEL[row.kind]}
                    </span>
                    <span className="font-medium">{row.title}</span>
                  </div>
                  <div className="text-sm text-ink-300 mt-1">{row.body}</div>
                  <div className="text-xs text-ink-500 mt-1">
                    {new Date(row.createdAt).toLocaleString()}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {hasMore && (
        <div className="text-center">
          <button onClick={loadMore} disabled={busy} className="ons-btn-secondary">
            {busy ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
