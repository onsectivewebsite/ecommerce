'use client';

import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Badge, Money } from '@onsective/ui';
import type { OrderDto } from '@onsective/shared-types';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function OrderDetail() {
  const params = useParams<{ id: string }>();
  const sp = useSearchParams();
  const justPlaced = sp.get('placed') === '1';
  const { user, loading: authLoading } = useAuth();
  const [order, setOrder] = React.useState<OrderDto | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (authLoading || !user) return;
    api.orders.get(params.id).then(setOrder).catch((e) => setErr(e?.message ?? 'Not found'));
  }, [authLoading, user, params.id]);

  if (authLoading) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!user) return <div className="container py-16"><Link href="/login" className="ons-btn-primary">Sign in</Link></div>;
  if (err) return <div className="container py-16 text-danger">{err}</div>;
  if (!order) return <div className="container py-16 text-ink-400">Loading order…</div>;

  return (
    <div className="container py-10 max-w-4xl">
      {justPlaced && (
        <div className="ons-card border-success/40 bg-success/10 mb-6">
          <h2 className="font-display text-2xl">Order placed</h2>
          <p className="text-ink-300 mt-1">Thank you. We've notified the seller and you'll get tracking soon.</p>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs text-ink-400">Order #{order.id.slice(-8)}</div>
          <h1 className="font-display text-2xl tracking-tight">{order.sellerName}</h1>
        </div>
        <Badge tone={order.status === 'PAID' ? 'success' : order.status === 'CANCELLED' ? 'danger' : 'accent'}>{order.status}</Badge>
      </div>

      <div className="grid md:grid-cols-[1fr_320px] gap-6">
        <div className="ons-card space-y-3">
          {order.items.map((i) => (
            <div key={i.id} className="flex items-center justify-between border-b border-ink-800 last:border-0 pb-3 last:pb-0">
              <div>
                <div className="font-medium">{i.productTitleSnapshot}</div>
                <div className="text-sm text-ink-400">{i.variantNameSnapshot} · qty {i.qty}</div>
              </div>
              <Money amountMinor={i.lineSubtotalMinor} currency={order.currency} />
            </div>
          ))}
        </div>
        <aside className="ons-card h-fit space-y-3">
          <div className="flex justify-between text-ink-300"><span>Subtotal</span><Money amountMinor={order.subtotalMinor} currency={order.currency} /></div>
          <div className="flex justify-between text-ink-300"><span>Shipping</span><Money amountMinor={order.shippingMinor} currency={order.currency} /></div>
          <div className="flex justify-between text-ink-300"><span>Tax</span><Money amountMinor={order.taxMinor} currency={order.currency} /></div>
          <div className="h-px bg-ink-800" />
          <div className="flex justify-between"><span className="font-semibold">Total</span><Money amountMinor={order.totalMinor} currency={order.currency} emphasized /></div>
          <div className="text-xs text-ink-400 pt-2">Payment via {order.payment.provider} ({order.payment.status})</div>
          {order.shipment ? (
            <div className="mt-3 border-t border-ink-800 pt-3">
              <div className="text-sm">
                <span className="text-ink-300">Carrier:</span>{' '}
                <span className="uppercase">{order.shipment.carrierCode}</span>{' '}
                <span className="text-ink-400">· {order.shipment.serviceLevel}</span>
              </div>
              <div className="text-sm">
                <span className="text-ink-300">Tracking:</span>{' '}
                <span>{order.shipment.trackingNumber ?? 'pending label'}</span>
              </div>
              <Link href={`/track/${order.shipment.publicToken}`} className="text-accent-300 text-sm mt-1 inline-block">
                Track this package →
              </Link>
            </div>
          ) : (
            <div className="text-xs text-ink-400 pt-1">Tracking will appear here after the label is purchased.</div>
          )}
          <div>
            <h3 className="text-sm uppercase tracking-wider text-ink-400 mt-2">Ship to</h3>
            <div className="text-sm text-ink-200 mt-1">
              {order.shippingAddress.fullName}<br />
              {order.shippingAddress.line1}<br />
              {order.shippingAddress.city}, {order.shippingAddress.region} {order.shippingAddress.postalCode}<br />
              {order.shippingAddress.country}
            </div>
          </div>
          <div className="border-t border-ink-800 pt-3 mt-3 flex flex-col gap-2">
            <Link href={`/orders/${order.id}/messages`} className="ons-btn-ghost text-sm text-center">
              Message seller
            </Link>
            {order.status === 'DELIVERED' || order.status === 'PAID' ? (
              <Link href={`/account/returns/new?orderId=${order.id}`} className="ons-btn-ghost text-sm text-center">
                Start a return
              </Link>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

// (removed — tracking link rendered inline below)
