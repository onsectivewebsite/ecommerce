'use client';

import * as React from 'react';
import Link from 'next/link';
import { Badge } from '@onsective/ui';
import type { WebhookEndpointRow, WebhookEventKind } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const EVENT_KINDS: WebhookEventKind[] = [
  'ORDER_PLACED', 'ORDER_PAID', 'ORDER_CANCELLED',
  'SHIPMENT_LABEL_CREATED', 'SHIPMENT_DELIVERED',
  'RETURN_REQUESTED', 'RETURN_APPROVED', 'RETURN_REFUNDED',
  'REVIEW_POSTED', 'PAYOUT_PAID',
];

export default function WebhooksPage() {
  const { user, loading } = useAuth();
  const [rows, setRows] = React.useState<WebhookEndpointRow[] | null>(null);
  const [secretReveal, setSecretReveal] = React.useState<{ id: string; secret: string } | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [showCreate, setShowCreate] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const [name, setName] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [events, setEvents] = React.useState<Set<WebhookEventKind>>(new Set());

  const load = React.useCallback(() => {
    api.webhooks.list().then(setRows).catch(() => setRows([]));
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function create() {
    setCreating(true); setErr(null);
    try {
      const res = await api.webhooks.create({ name, url, events: Array.from(events) });
      setSecretReveal({ id: res.id, secret: res.secret });
      setName(''); setUrl(''); setEvents(new Set()); setShowCreate(false);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function toggle(e: WebhookEndpointRow) {
    await api.webhooks.update(e.id, { active: !e.active });
    load();
  }

  async function rotate(id: string) {
    if (!confirm('Rotate the secret? Your existing integration will need the new value.')) return;
    const r = await api.webhooks.rotate(id);
    setSecretReveal(r);
  }

  async function remove(id: string) {
    if (!confirm('Delete this endpoint? Pending deliveries will be lost.')) return;
    await api.webhooks.remove(id);
    load();
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!rows) return <div className="container py-16 text-ink-400">Loading webhooks…</div>;

  return (
    <div className="container py-10 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-3xl tracking-tight">Webhooks</h1>
        <button onClick={() => setShowCreate((v) => !v)} className="ons-btn-primary text-sm">
          {showCreate ? 'Cancel' : '+ New endpoint'}
        </button>
      </div>

      <p className="text-sm text-ink-400 mb-6">
        Receive HTTPS callbacks when key events happen on your store. Verify each request by computing
        <code className="mx-1 bg-ink-800 px-1.5 py-0.5 rounded text-xs">HMAC-SHA256(secret, "{`{ts}.{body}`}")</code>
        and comparing it to the <code className="mx-1 bg-ink-800 px-1.5 py-0.5 rounded text-xs">X-Onsective-Signature</code> header.
      </p>

      {secretReveal && (
        <div className="ons-card mb-6 border-warning/40 bg-warning/10">
          <h2 className="font-medium">Save this secret now</h2>
          <p className="text-sm text-ink-300 mt-1">You won't see it again. Store it in your environment as <code>ONSECTIVE_WEBHOOK_SECRET</code>.</p>
          <pre className="font-mono text-xs bg-ink-900 p-3 rounded mt-2 select-all">{secretReveal.secret}</pre>
          <button onClick={() => setSecretReveal(null)} className="ons-btn-ghost text-sm mt-2">I've saved it</button>
        </div>
      )}

      {showCreate && (
        <div className="ons-card mb-6 space-y-3">
          <h2 className="font-medium">New endpoint</h2>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Friendly name" className="ons-input w-full" />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-server.com/onsective" className="ons-input w-full" />
          <div>
            <div className="text-xs text-ink-400 mb-2">Subscribed events</div>
            <div className="grid sm:grid-cols-2 gap-1.5 text-sm">
              {EVENT_KINDS.map((k) => (
                <label key={k} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={events.has(k)}
                    onChange={(e) => {
                      setEvents((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(k); else next.delete(k);
                        return next;
                      });
                    }}
                  />
                  <code className="text-xs">{k}</code>
                </label>
              ))}
            </div>
          </div>
          {err && <div className="text-danger text-sm">{err}</div>}
          <button
            disabled={creating || !name || !url || events.size === 0}
            onClick={create}
            className="ons-btn-primary"
          >
            {creating ? 'Creating…' : 'Create endpoint'}
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-ink-400">No endpoints yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((e) => (
            <div key={e.id} className="ons-card">
              <div className="flex items-start gap-4">
                <div className="flex-1">
                  <div className="font-medium">{e.name}</div>
                  <div className="text-xs text-ink-400 break-all">{e.url}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {e.events.map((ev) => (
                      <code key={ev} className="text-[10px] bg-ink-800 px-1.5 py-0.5 rounded">{ev}</code>
                    ))}
                  </div>
                </div>
                <Badge tone={e.active ? 'success' : 'neutral'}>{e.active ? 'active' : 'paused'}</Badge>
              </div>
              <div className="flex items-center gap-2 mt-3">
                <Link href={`/webhooks/${e.id}`} className="ons-btn-ghost text-sm">Deliveries</Link>
                <button onClick={() => toggle(e)} className="ons-btn-ghost text-sm">
                  {e.active ? 'Pause' : 'Activate'}
                </button>
                <button onClick={() => rotate(e.id)} className="ons-btn-ghost text-sm">Rotate secret</button>
                <button onClick={() => remove(e.id)} className="ons-btn-ghost text-sm text-danger">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
