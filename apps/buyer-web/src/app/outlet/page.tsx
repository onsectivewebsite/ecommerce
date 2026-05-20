import type { Metadata } from 'next';
import Link from 'next/link';
import { PUBLIC_API_URL } from '@/lib/env';
import { Money } from '@onsective/ui';
import type { OutletCondition, OutletListing } from '@onsective/api-client';
import { TrustBadge } from '@/components/TrustBadge';
import { JsonLd } from '@/components/JsonLd';

export const dynamic = 'force-dynamic';

const BUYER_ORIGIN = process.env.NEXT_PUBLIC_BUYER_URL ?? 'http://localhost:3000';

const FILTERS: Array<{ label: string; value?: OutletCondition }> = [
  { label: 'All', value: undefined },
  { label: 'Open box', value: 'OPEN_BOX' },
  { label: 'Grade A', value: 'REFURB_GRADE_A' },
  { label: 'Grade B', value: 'REFURB_GRADE_B' },
  { label: 'Grade C', value: 'REFURB_GRADE_C' },
];

export async function generateMetadata(): Promise<Metadata> {
  const url = `${BUYER_ORIGIN}/outlet`;
  const description = 'Open-box and certified refurbished units at outlet prices. Every unit inspected and platform-warranted.';
  return {
    title: 'Outlet — Onsective',
    description,
    alternates: { canonical: url },
    openGraph: {
      title: 'Onsective Outlet',
      description,
      url,
      type: 'website',
      siteName: 'Onsective',
    },
    twitter: {
      card: 'summary',
      title: 'Onsective Outlet',
      description,
    },
  };
}

export default async function OutletPage({ searchParams }: { searchParams: { condition?: OutletCondition; brand?: string } }) {
  const qs = new URLSearchParams();
  if (searchParams.condition) qs.set('condition', searchParams.condition);
  if (searchParams.brand) qs.set('brand', searchParams.brand);
  const url = `${PUBLIC_API_URL}/outlet/listings${qs.toString() ? `?${qs.toString()}` : ''}`;
  const res = await fetch(url, { cache: 'no-store' });
  const listings = res.ok ? ((await res.json()) as OutletListing[]) : [];

  const itemListJsonLd = listings.length > 0 ? {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: listings.slice(0, 60).map((l, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${BUYER_ORIGIN}/p/${encodeURIComponent(l.slug)}`,
      name: l.title,
    })),
  } : null;

  return (
    <div className="container py-10">
      {itemListJsonLd && <JsonLd data={itemListJsonLd} />}
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] uppercase tracking-[0.18em] text-gold-400">Onsective</span>
          <span className="text-[10px] uppercase tracking-[0.18em] text-ink-400">Outlet</span>
        </div>
        <h1 className="font-display text-3xl tracking-tight">Open-box & certified refurbished</h1>
        <p className="text-sm text-ink-400 mt-1 max-w-2xl">
          Every unit on this page was inspected at our warehouse, passed an authenticity check,
          and ships with a platform-backed warranty. You get the deeper discount; we recover
          the unit responsibly.
        </p>
      </header>

      <div className="flex flex-wrap gap-2 mb-6">
        {FILTERS.map((f) => {
          const active = searchParams.condition === f.value || (!searchParams.condition && !f.value);
          const href = f.value ? `/outlet?condition=${f.value}` : '/outlet';
          return (
            <Link key={f.label} href={href} className={[
              'rounded-full border px-3 py-1 text-xs',
              active ? 'border-gold-500 bg-gold-500/10 text-gold-200' : 'border-ink-800 text-ink-300',
            ].join(' ')}>{f.label}</Link>
          );
        })}
      </div>

      {listings.length === 0 ? (
        <p className="text-ink-400">No outlet items match these filters right now.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {listings.map((l) => (
            <Link key={l.productId} href={`/p/${l.slug}`}
                  className="group ons-card overflow-hidden p-0 transition-transform hover:-translate-y-0.5">
              <div className="relative aspect-square bg-ink-800 overflow-hidden">
                {l.media[0]?.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.media[0].url} alt={l.title}
                       className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
                ) : null}
                {l.discountBps > 0 && (
                  <div className="absolute top-2 left-2 rounded-md bg-emerald-500/90 text-emerald-950 text-xs font-semibold px-2 py-1">
                    {Math.round(l.discountBps / 100)}% off
                  </div>
                )}
              </div>
              <div className="p-4">
                <div className="text-xs uppercase tracking-wider text-ink-400">{l.brand?.name ?? l.sellerName}</div>
                <div className="mt-1 line-clamp-2 font-medium text-ink-50">{l.title}</div>
                <div className="mt-2 flex items-baseline gap-2">
                  <Money amountMinor={l.outletPriceMinor} currency={l.currency as 'USD'} emphasized />
                  <span className="text-xs text-ink-500 line-through">
                    {(l.msrpMinor / 100).toFixed(2)}
                  </span>
                </div>
                <div className="mt-2">
                  <TrustBadge condition={l.condition} size="sm" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
