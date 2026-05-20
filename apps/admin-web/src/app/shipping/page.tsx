'use client';

import * as React from 'react';
import { Badge, Card, CardDescription, CardTitle, Money } from '@onsective/ui';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

interface ShippingRuleRow {
  id: string;
  sellerId: string;
  name: string;
  priority: number;
  minWeightGrams: number;
  maxWeightGrams: number | null;
  destinationCountries: string[];
  flatRateMinor: number | null;
  freeAboveMinor: number | null;
  carrierCodeWhitelist: string[];
  enabled: boolean;
  currency: string;
}

export default function AdminShippingPage() {
  const { user, loading } = useAuth();
  const [rules, setRules] = React.useState<ShippingRuleRow[] | null>(null);
  const [sellers, setSellers] = React.useState<any[]>([]);

  React.useEffect(() => {
    if (loading || !user) return;
    api.shipping.adminRules().then((r) => setRules(r as ShippingRuleRow[])).catch(() => setRules([]));
    api.admin.listSellers().then(setSellers).catch(() => undefined);
  }, [loading, user]);

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!rules) return <div className="container py-16 text-ink-400">Loading rules…</div>;

  const sellerById = new Map<string, string>(sellers.map((s) => [s.id, s.displayName]));

  return (
    <div className="container py-10 space-y-6">
      <header>
        <h1 className="font-display text-3xl tracking-tight">Shipping rules</h1>
        <p className="text-ink-400 text-sm">Per-seller carrier whitelist, weight bands, free-shipping thresholds.</p>
      </header>

      {rules.length === 0 ? (
        <Card>
          <CardTitle>No rules yet</CardTitle>
          <CardDescription>Sellers will inherit the platform flat shipping rate from <code>platform.flat_shipping.minor</code>.</CardDescription>
        </Card>
      ) : (
        <div className="ons-card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-900 text-ink-400">
              <tr>
                <th className="text-left p-3">Seller</th>
                <th className="text-left p-3">Rule</th>
                <th className="text-left p-3">Priority</th>
                <th className="text-left p-3">Weight band</th>
                <th className="text-left p-3">Countries</th>
                <th className="text-right p-3">Flat / Free above</th>
                <th className="text-left p-3">Carriers</th>
                <th className="text-right p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className="border-t border-ink-800">
                  <td className="p-3">{sellerById.get(r.sellerId) ?? r.sellerId.slice(-8)}</td>
                  <td className="p-3 font-medium">{r.name}</td>
                  <td className="p-3">{r.priority}</td>
                  <td className="p-3 text-ink-300">{r.minWeightGrams}g – {r.maxWeightGrams ?? '∞'}g</td>
                  <td className="p-3 text-ink-300">{r.destinationCountries.length === 0 ? 'Any' : r.destinationCountries.join(', ')}</td>
                  <td className="p-3 text-right">
                    {r.flatRateMinor != null && <Money amountMinor={r.flatRateMinor} currency={r.currency as any} />}
                    {r.freeAboveMinor != null && <div className="text-xs text-ink-400">Free above <Money amountMinor={r.freeAboveMinor} currency={r.currency as any} /></div>}
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {r.carrierCodeWhitelist.map((c) => <Badge key={c} tone="accent" className="uppercase">{c}</Badge>)}
                    </div>
                  </td>
                  <td className="p-3 text-right">
                    <Badge tone={r.enabled ? 'success' : 'neutral'}>{r.enabled ? 'ENABLED' : 'DISABLED'}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
