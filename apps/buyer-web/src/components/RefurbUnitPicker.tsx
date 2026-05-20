'use client';

import * as React from 'react';
import { Badge, Money } from '@onsective/ui';
import type { ProductDetailDto } from '@onsective/shared-types';
import type { RefurbUnitRow } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export function RefurbUnitPicker({ product, units }: { product: ProductDetailDto; units: RefurbUnitRow[] }) {
  const { user } = useAuth();
  const [adding, setAdding] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [isPlus, setIsPlus] = React.useState(false);

  React.useEffect(() => {
    if (!user) { setIsPlus(false); return; }
    let cancelled = false;
    api.loyalty.myMembership()
      .then((r) => {
        if (cancelled) return;
        const m = r.membership;
        setIsPlus(
          !!m && m.status === 'ACTIVE' && new Date(m.expiresAt).getTime() > Date.now(),
        );
      })
      .catch(() => setIsPlus(false));
    return () => { cancelled = true; };
  }, [user]);

  // Plus benefit: +3mo on platform warranty, clamped at 24mo.
  const PLUS_BUMP = 3;
  const PLUS_CAP = 24;
  function effectiveMonths(base: number) {
    return isPlus && base > 0 ? Math.min(PLUS_CAP, base + PLUS_BUMP) : base;
  }

  async function addToCart(u: RefurbUnitRow) {
    if (!u.variantId) {
      setMsg('This unit is not currently purchasable.');
      return;
    }
    setAdding(u.id); setMsg(null);
    try {
      await api.cart.addItem({ variantId: u.variantId, qty: 1 });
      setMsg('Added to cart.');
    } catch (e) {
      setMsg((e as Error).message);
    } finally { setAdding(null); }
  }

  if (units.length === 0) {
    return (
      <div className="ons-card text-sm text-ink-400">
        No certified refurbished units available right now. Check back soon — every unit
        passes inspection at our warehouse before listing.
      </div>
    );
  }

  return (
    <div className="ons-card space-y-3">
      <div>
        <h3 className="font-medium">Available certified units</h3>
        <p className="text-xs text-ink-400 mt-1">
          Each listing is a specific physical unit with its own photos and condition report.
        </p>
      </div>
      <div className="space-y-2">
        {units.map((u) => {
          const report = (u.conditionReport ?? {}) as Record<string, unknown>;
          const battery = typeof report.batteryHealth === 'number' ? `${report.batteryHealth}% battery` : null;
          const replaced = Array.isArray(report.replacedParts) ? (report.replacedParts as string[]).join(', ') : null;
          return (
            <div key={u.id} className="border border-ink-800 rounded-lg p-3">
              <div className="flex items-start gap-3">
                <Badge tone="warning">Grade {product.condition?.replace('REFURB_GRADE_', '') ?? '?'}</Badge>
                <div className="flex-1">
                  <p className="text-sm font-medium">Unit · serial {u.serialNumber}</p>
                  <div className="text-xs text-ink-400 mt-1">
                    {[
                      battery,
                      replaced && `Replaced: ${replaced}`,
                      isPlus && u.warrantyMonths > 0
                        ? `${effectiveMonths(u.warrantyMonths)}mo platform warranty (Plus +${Math.min(PLUS_BUMP, PLUS_CAP - u.warrantyMonths)}mo)`
                        : `${u.warrantyMonths}mo platform warranty`,
                    ].filter(Boolean).join(' · ')}
                  </div>
                  {u.unitPhotoMediaIds.length > 0 && (
                    <p className="text-xs text-ink-500 mt-1">{u.unitPhotoMediaIds.length} unit photo(s) on file</p>
                  )}
                  {u.aiSummary && u.aiSummary.suggestion === 'PASS' && (
                    <p className="text-xs text-emerald-300 mt-1">
                      Vision-verified · {(u.aiSummary.confidence * 100).toFixed(0)}% confidence
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Money amountMinor={u.priceMinor} currency={u.currency as 'USD'} emphasized />
                  <button
                    onClick={() => addToCart(u)}
                    disabled={adding === u.id || u.availability !== 'AVAILABLE'}
                    className="ons-btn-primary text-xs"
                  >
                    {adding === u.id ? 'Adding…' : u.availability === 'AVAILABLE' ? 'Add to cart' : u.availability}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {msg && <div className="text-xs text-ink-300">{msg}</div>}
    </div>
  );
}
