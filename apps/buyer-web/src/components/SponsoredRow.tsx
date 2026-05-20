'use client';

import * as React from 'react';
import type { AdPlacementType, CurrencyCode, ResolvedAdDto } from '@onsective/shared-types';
import { Money } from '@onsective/ui';
import { api } from '@/lib/api';
import { PUBLIC_API_URL } from '@/lib/env';

interface Props {
  type: AdPlacementType;
  q?: string;
  category?: string;
  className?: string;
}

/**
 * Resolves a single sponsored placement at render time, fires an impression
 * beacon (idempotent via eventKey), and renders a "Sponsored" card with a
 * click-tracking <a href> that 302s through /ads/click/:placementId.
 */
export function SponsoredRow({ type, q, category, className }: Props) {
  const [ad, setAd] = React.useState<ResolvedAdDto | null>(null);
  const eventKey = React.useMemo(
    () => `imp_${Math.random().toString(36).slice(2)}_${Date.now()}`,
    [],
  );

  React.useEffect(() => {
    let cancelled = false;
    api.ads.serve(type, { q, category })
      .then((resolved) => {
        if (cancelled || !resolved) { setAd(null); return; }
        setAd(resolved);
        api.ads.recordImpression({
          campaignId: resolved.campaignId,
          placementId: resolved.placementId,
          eventKey,
        }).catch(() => undefined);
      })
      .catch(() => setAd(null));
    return () => { cancelled = true; };
  }, [type, q, category, eventKey]);

  if (!ad) return null;
  const clickHref = api.ads.clickUrl(PUBLIC_API_URL, ad.placementId, eventKey);
  const p = ad.product;

  return (
    <div className={['ons-card border-gold-500/30 bg-gold-500/5', className ?? ''].join(' ')}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs uppercase tracking-[0.18em] text-gold-400">Sponsored</span>
        <span className="text-xs text-ink-500">from {ad.sellerName ?? 'an Onsective seller'}</span>
      </div>
      {p ? (
        <a href={clickHref} className="group flex gap-4 items-center">
          {p.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.imageUrl} alt={p.title} className="h-24 w-24 rounded-xl object-cover bg-ink-800" />
          ) : (
            <div className="h-24 w-24 rounded-xl bg-ink-800" />
          )}
          <div className="flex-1">
            <div className="text-lg font-medium group-hover:text-accent-200">{p.title}</div>
            <div className="text-sm text-ink-300 mt-1">
              <Money amountMinor={p.basePriceMinor} currency={p.currency as CurrencyCode} />
            </div>
          </div>
        </a>
      ) : (
        <a href={clickHref} className="block text-accent-200 hover:underline">
          {ad.destinationUrl ?? 'Learn more →'}
        </a>
      )}
    </div>
  );
}
