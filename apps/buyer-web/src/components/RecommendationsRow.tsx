'use client';

import * as React from 'react';
import Link from 'next/link';
import { Money } from '@onsective/ui';
import type { CurrencyCode, ProductSummaryDto } from '@onsective/shared-types';
import { api } from '@/lib/api';

interface Props {
  productId: string;
  type: 'fbt' | 'similar';
}

const HEADING: Record<Props['type'], string> = {
  fbt: 'Frequently bought together',
  similar: 'Similar items',
};

export function RecommendationsRow({ productId, type }: Props) {
  const [items, setItems] = React.useState<ProductSummaryDto[] | null>(null);

  React.useEffect(() => {
    const fn = type === 'fbt' ? api.recommendations.fbt(productId) : api.recommendations.similar(productId);
    fn.then((rows) => setItems(rows)).catch(() => setItems([]));
  }, [productId, type]);

  if (!items || items.length === 0) return null;

  return (
    <section aria-label={HEADING[type]} className="mt-12">
      <h3 className="text-sm uppercase tracking-wider text-ink-400 mb-3">{HEADING[type]}</h3>
      <ul className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {items.map((p) => (
          <li key={p.id} className="ons-card p-0 overflow-hidden">
            <Link href={`/p/${p.slug}`} className="block focus:outline-none focus:ring-2 focus:ring-accent-500 rounded-md">
              {p.media[0]?.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.media[0].url} alt={p.media[0].alt ?? p.title} className="aspect-square w-full object-cover" />
              ) : (
                <div className="aspect-square bg-ink-800" />
              )}
              <div className="p-3">
                <span className="block text-sm text-ink-50 line-clamp-1">{p.title}</span>
                <Money amountMinor={p.basePriceMinor} currency={p.currency as CurrencyCode} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
