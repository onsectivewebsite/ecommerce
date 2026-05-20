'use client';

import Link from 'next/link';
import { Money } from '@onsective/ui';
import type { ProductSummaryDto } from '@onsective/shared-types';
import { TrustBadge } from './TrustBadge';

export function ProductCard({ p }: { p: ProductSummaryDto }) {
  const img = p.media[0]?.url;
  return (
    <Link
      href={`/p/${p.slug}`}
      className="group ons-card overflow-hidden p-0 transition-transform hover:-translate-y-0.5 hover:shadow-elev3"
    >
      <div className="aspect-square bg-ink-800 overflow-hidden">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img}
            alt={p.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            loading="lazy"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-ink-500 text-xs">no image</div>
        )}
      </div>
      <div className="p-4">
        <div className="text-xs uppercase tracking-wider text-ink-400">{p.sellerName}</div>
        <div className="mt-1 line-clamp-2 font-medium text-ink-50">{p.title}</div>
        <div className="mt-2">
          <Money amountMinor={p.basePriceMinor} currency={p.currency} emphasized />
        </div>
        <div className="mt-2">
          <TrustBadge condition={p.condition} brand={p.brand} size="sm" />
        </div>
      </div>
    </Link>
  );
}
