'use client';

import * as React from 'react';
import Link from 'next/link';
import type { ConsentRecordRow, NotificationPrefs } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const CATEGORIES: Array<{ id: string; label: string; group: 'Orders' | 'Shipping' | 'Returns' | 'Engagement' | 'Messages' }> = [
  { id: 'order_paid',             label: 'Order confirmation',         group: 'Orders' },
  { id: 'shipment_picked_up',     label: 'Shipment picked up',         group: 'Shipping' },
  { id: 'shipment_in_transit',    label: 'In transit',                 group: 'Shipping' },
  { id: 'shipment_out_for_delivery', label: 'Out for delivery',        group: 'Shipping' },
  { id: 'shipment_delivered',     label: 'Delivered',                  group: 'Shipping' },
  { id: 'shipment_exception',     label: 'Delivery exceptions',        group: 'Shipping' },
  { id: 'return_approved',        label: 'Return approved',            group: 'Returns' },
  { id: 'return_rejected',        label: 'Return rejected',            group: 'Returns' },
  { id: 'return_refunded',        label: 'Refund issued',              group: 'Returns' },
  { id: 'wishlist_price_drop',    label: 'Wishlist price drops',       group: 'Engagement' },
  { id: 'wishlist_back_in_stock', label: 'Back-in-stock alerts',       group: 'Engagement' },
  { id: 'cart_recovery_24h',      label: 'Cart reminders (24h)',       group: 'Engagement' },
  { id: 'cart_recovery_72h',      label: 'Cart reminders (72h)',       group: 'Engagement' },
  { id: 'message_new',            label: 'New messages on orders',     group: 'Messages' },
  { id: 'dispute_opened',         label: 'Disputes opened on orders',  group: 'Messages' },
  { id: 'dispute_resolved',       label: 'Dispute resolutions',        group: 'Messages' },
];

const GROUPS = ['Orders', 'Shipping', 'Returns', 'Engagement', 'Messages'] as const;

export default function PreferencesPage() {
  const { user, loading } = useAuth();
  const [prefs, setPrefs] = React.useState<NotificationPrefs | null>(null);
  const [consent, setConsent] = React.useState<ConsentRecordRow | null>(null);
  const [consentBusy, setConsentBusy] = React.useState(false);

  React.useEffect(() => {
    if (loading || !user) return;
    api.preferences.notifications().then(setPrefs).catch(() => setPrefs({}));
    api.privacy
      .getConsent()
      .then((r) => setConsent(r.record))
      .catch(() => setConsent(null));
  }, [loading, user]);

  if (loading) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!user) return <div className="container py-16"><Link href="/login?next=/account/preferences" className="ons-btn-primary">Sign in</Link></div>;
  if (!prefs) return <div className="container py-16 text-ink-400">Loading preferences…</div>;

  function isEnabled(catId: string, channel: 'email' | 'push'): boolean {
    const cat = prefs?.[catId];
    if (!cat) return true;
    return cat[channel] !== false;
  }

  async function set(category: string, channel: 'email' | 'push', enabled: boolean) {
    const next = await api.preferences.setNotification({ category, channel, enabled });
    setPrefs(next);
  }

  async function updateConsent(patch: Partial<ConsentRecordRow>) {
    setConsentBusy(true);
    try {
      const next = await api.privacy.updatePreferences({
        functional: patch.functional ?? consent?.functional,
        analytics: patch.analytics ?? consent?.analytics,
        marketing: patch.marketing ?? consent?.marketing,
        marketingEmail: patch.marketingEmail ?? consent?.marketingEmail,
        marketingSms: patch.marketingSms ?? consent?.marketingSms,
        marketingPush: patch.marketingPush ?? consent?.marketingPush,
      });
      setConsent(next);
    } finally {
      setConsentBusy(false);
    }
  }

  return (
    <div className="container py-10 max-w-3xl">
      <h1 className="font-display text-3xl tracking-tight mb-6">Preferences</h1>

      {/* Phase 32: marketing master switches via consent record */}
      <section className="ons-card mb-6">
        <h2 className="font-medium mb-1">Marketing communications</h2>
        <p className="text-sm text-ink-400 mb-4">
          Master switches. When a channel is off here, we won't send marketing on that channel even if individual categories below are checked. Transactional sends (orders, shipping, security, billing) are not affected.
        </p>
        {!consent ? (
          <p className="text-xs text-ink-500">No consent record on file yet — your choices will be saved here once you accept or reject in the cookie banner.</p>
        ) : (
          <div className="space-y-2">
            <ToggleRow
              label="All marketing communications"
              description="Master switch — turn this off to silence every marketing channel below."
              checked={consent.marketing}
              onChange={(v) => updateConsent({ marketing: v, marketingEmail: v && consent.marketingEmail, marketingPush: v && consent.marketingPush, marketingSms: v && consent.marketingSms })}
              disabled={consentBusy}
            />
            <ToggleRow
              label="Marketing email"
              description="Promotions, price drops, restock alerts, abandoned-cart reminders."
              checked={consent.marketing && consent.marketingEmail}
              onChange={(v) => updateConsent({ marketingEmail: v, marketing: v ? true : consent.marketing })}
              disabled={consentBusy || !consent.marketing}
            />
            <ToggleRow
              label="Marketing push"
              description="In-app push notifications for promotions and re-engagement."
              checked={consent.marketing && consent.marketingPush}
              onChange={(v) => updateConsent({ marketingPush: v, marketing: v ? true : consent.marketing })}
              disabled={consentBusy || !consent.marketing}
            />
            <ToggleRow
              label="Marketing SMS"
              description="Text messages — strictly opt-in, off by default."
              checked={consent.marketing && consent.marketingSms}
              onChange={(v) => updateConsent({ marketingSms: v, marketing: v ? true : consent.marketing })}
              disabled={consentBusy || !consent.marketing}
            />
            <ToggleRow
              label="Personalized analytics"
              description="Product analytics and A/B tests. No advertising tracking."
              checked={consent.analytics}
              onChange={(v) => updateConsent({ analytics: v })}
              disabled={consentBusy}
            />
          </div>
        )}
      </section>

      <h2 className="font-display text-2xl tracking-tight mb-3">Per-category notifications</h2>
      <p className="text-sm text-ink-400 mb-6">
        Choose which updates you want to receive by email or push. Critical security and account events are always sent.
      </p>
      {GROUPS.map((g) => (
        <div key={g} className="ons-card mb-4">
          <h3 className="font-medium mb-3">{g}</h3>
          <table className="w-full text-sm">
            <thead className="text-ink-400 text-xs uppercase">
              <tr>
                <th className="text-left py-1.5">Category</th>
                <th className="text-center py-1.5 w-20">Email</th>
                <th className="text-center py-1.5 w-20">Push</th>
              </tr>
            </thead>
            <tbody>
              {CATEGORIES.filter((c) => c.group === g).map((c) => (
                <tr key={c.id} className="border-t border-ink-800">
                  <td className="py-2">{c.label}</td>
                  <td className="text-center">
                    <input
                      type="checkbox"
                      checked={isEnabled(c.id, 'email')}
                      onChange={(e) => set(c.id, 'email', e.target.checked)}
                    />
                  </td>
                  <td className="text-center">
                    <input
                      type="checkbox"
                      checked={isEnabled(c.id, 'push')}
                      onChange={(e) => set(c.id, 'push', e.target.checked)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function ToggleRow(props: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={`flex items-start gap-3 cursor-pointer ${props.disabled ? 'opacity-60' : ''}`}>
      <input
        type="checkbox"
        className="mt-1"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
      />
      <span>
        <span className="font-medium text-ink-100">{props.label}</span>
        <span className="block text-xs text-ink-400">{props.description}</span>
      </span>
    </label>
  );
}
