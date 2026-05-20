'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { ThreadView } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function OrderMessagesPage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;
  const { user, loading: authLoading } = useAuth();
  const [thread, setThread] = React.useState<ThreadView | null>(null);
  const [draft, setDraft] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const load = React.useCallback(async () => {
    try {
      const t = await api.messaging.orderThread(orderId);
      setThread(t);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [orderId]);

  React.useEffect(() => {
    if (authLoading || !user) return;
    load();
    pollRef.current = setInterval(load, 10_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [authLoading, user, load]);

  async function send() {
    if (!thread || !draft.trim()) return;
    setSending(true);
    try {
      await api.messaging.send(thread.id, { body: draft.trim() });
      setDraft('');
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (authLoading) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!user) return <div className="container py-16"><Link href={`/login?next=/orders/${orderId}/messages`} className="ons-btn-primary">Sign in</Link></div>;
  if (err) return <div className="container py-16 text-danger">{err}</div>;
  if (!thread) return <div className="container py-16 text-ink-400">Loading thread…</div>;

  return (
    <div className="container py-10 max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-display text-2xl tracking-tight">Messages · order #{orderId.slice(-8)}</h1>
        <Link href={`/orders/${orderId}`} className="ons-btn-ghost text-sm">Back to order</Link>
      </div>
      <div className="ons-card">
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {thread.messages.length === 0 ? (
            <p className="text-ink-400 text-sm">No messages yet. Say hi to the seller.</p>
          ) : thread.messages.map((m) => (
            <div
              key={m.id}
              className={`rounded-md px-3 py-2 ${
                m.senderKind === 'BUYER' ? 'bg-accent-500/10 ml-12' :
                m.senderKind === 'SYSTEM' ? 'bg-ink-800/40 text-xs italic text-ink-300 text-center' :
                'bg-ink-800/60 mr-12'
              }`}
            >
              <div className="text-xs text-ink-400 mb-1">{m.senderKind.toLowerCase()} · {new Date(m.createdAt).toLocaleString()}</div>
              <div className="whitespace-pre-wrap">{m.body}</div>
              {m.attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {m.attachments.map((a) => (
                    <a key={a.key} href={a.url} target="_blank" rel="noreferrer" className="text-accent-300 text-xs underline">
                      attachment
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="border-t border-ink-800 mt-4 pt-4 flex gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type a message…"
            rows={2}
            className="ons-input flex-1"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
          />
          <button disabled={sending || !draft.trim()} onClick={send} className="ons-btn-primary self-end">
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
