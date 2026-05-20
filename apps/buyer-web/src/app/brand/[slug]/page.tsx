import type { Metadata } from 'next';
import { PUBLIC_API_URL } from '@/lib/env';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { BrandStorefront, BrandStorefrontProductCard, BrandTotalsResult } from '@onsective/api-client';
import { Money } from '@onsective/ui';
import { TrustBadge } from '@/components/TrustBadge';
import { JsonLd } from '@/components/JsonLd';

export const dynamic = 'force-dynamic';

const BUYER_ORIGIN = process.env.NEXT_PUBLIC_BUYER_URL ?? 'http://localhost:3000';

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const res = await fetch(`${PUBLIC_API_URL}/brands/${encodeURIComponent(params.slug)}/storefront`, { cache: 'no-store' });
  if (!res.ok) return { title: 'Brand' };
  const s = (await res.json()) as BrandStorefront;
  const url = `${BUYER_ORIGIN}/brand/${encodeURIComponent(s.slug)}`;
  const description =
    (s.heroSubcopy ?? s.story ?? `${s.name} — certified products on Onsective.`)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);
  return {
    title: `${s.name} on Onsective`,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: `${s.name} on Onsective`,
      description,
      url,
      type: 'website',
      images: s.heroMediaUrl ? [{ url: s.heroMediaUrl, alt: s.name }] : undefined,
      siteName: 'Onsective',
    },
    twitter: {
      card: s.heroMediaUrl ? 'summary_large_image' : 'summary',
      title: `${s.name} on Onsective`,
      description,
      images: s.heroMediaUrl ? [s.heroMediaUrl] : undefined,
    },
  };
}

export default async function BrandStorefrontPage({ params }: { params: { slug: string } }) {
  const res = await fetch(`${PUBLIC_API_URL}/brands/${encodeURIComponent(params.slug)}/storefront`, { cache: 'no-store' });
  if (!res.ok) notFound();
  const s = (await res.json()) as BrandStorefront;
  const impactRes = await fetch(`${PUBLIC_API_URL}/sustainability/brands/${s.id}`, { cache: 'no-store' });
  const impact = impactRes.ok ? ((await impactRes.json()) as BrandTotalsResult) : null;

  const accent = s.accentColor && /^#?[0-9a-fA-F]{3,8}$/.test(s.accentColor)
    ? (s.accentColor.startsWith('#') ? s.accentColor : `#${s.accentColor}`)
    : null;

  const brandUrl = `${BUYER_ORIGIN}/brand/${encodeURIComponent(s.slug)}`;
  const organizationJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: s.name,
    url: brandUrl,
    ...(s.logoUrl ? { logo: s.logoUrl } : {}),
    ...(s.story ? { description: s.story.slice(0, 500) } : {}),
  };
  const itemListJsonLd = s.liveProducts.length > 0 ? {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: s.liveProducts.slice(0, 100).map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${BUYER_ORIGIN}/p/${encodeURIComponent(p.slug)}`,
      name: p.title,
    })),
  } : null;

  return (
    <div>
      <JsonLd data={organizationJsonLd} />
      {itemListJsonLd && <JsonLd data={itemListJsonLd} />}
      <section className="relative">
        {s.heroMediaUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.heroMediaUrl} alt={s.name}
               className="w-full h-[360px] object-cover" />
        ) : (
          <div className="w-full h-[240px] bg-ink-900" />
        )}
        <div className="container -mt-24 relative">
          <div className="ons-card max-w-3xl">
            <div className="flex items-center gap-3 mb-3">
              {s.logoUrl && <img src={s.logoUrl} alt="" className="w-12 h-12 object-contain rounded bg-ink-800 p-1" />}
              <div>
                <h1 className="font-display text-3xl tracking-tight" style={accent ? { color: accent } : undefined}>
                  {s.name}
                </h1>
                <p className="text-xs uppercase tracking-[0.18em] text-ink-400 mt-1">
                  {s.mode === 'INVENTORY_HOLDING' ? 'Onsective verified brand store' : 'Curated authorized resellers'}
                </p>
              </div>
            </div>
            {s.heroHeadline && <p className="text-xl text-ink-100">{s.heroHeadline}</p>}
            {s.heroSubcopy && <p className="text-sm text-ink-300 mt-2">{s.heroSubcopy}</p>}
          </div>
        </div>
      </section>

      <div className="container py-12 space-y-12">
        {s.collections.length > 0 && s.collections.map((c) => c.products.length > 0 && (
          <section key={c.id}>
            <div className="mb-4">
              <h2 className="font-display text-2xl tracking-tight">{c.title}</h2>
              {c.subtitle && <p className="text-sm text-ink-400 mt-1">{c.subtitle}</p>}
            </div>
            <ProductGrid products={c.products} />
          </section>
        ))}

        {impact && impact.totals.events > 0 && (
          <section className="ons-card">
            <h3 className="text-sm uppercase tracking-wider text-ink-400 mb-3">Impact with {s.name}</h3>
            <div className="grid sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-ink-400">kg CO₂ avoided</p>
                <p className="font-display text-2xl mt-1">{Math.round(impact.totals.kgCo2Saved).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-ink-400">kg material diverted</p>
                <p className="font-display text-2xl mt-1">{impact.totals.kgMaterialDiverted.toFixed(1)}</p>
              </div>
              <div>
                <p className="text-xs text-ink-400">circular events</p>
                <p className="font-display text-2xl mt-1">{impact.totals.events.toLocaleString()}</p>
              </div>
            </div>
          </section>
        )}

        {s.story && (
          <section className="grid md:grid-cols-3 gap-6">
            <div className="md:col-span-2 ons-card whitespace-pre-line text-ink-200 leading-relaxed">
              <h3 className="text-sm uppercase tracking-wider text-ink-400 mb-3">About {s.name}</h3>
              {s.story}
            </div>
            <div className="ons-card">
              <h3 className="text-sm uppercase tracking-wider text-ink-400 mb-3">Trust on Onsective</h3>
              <ul className="text-sm text-ink-300 space-y-2">
                <li>Every unit is inspected at our warehouse before sale.</li>
                <li>Authorized resellers and certified refurbishers only.</li>
                <li>Platform-backed warranty on refurbished items.</li>
              </ul>
            </div>
          </section>
        )}

        <section>
          <h2 className="font-display text-2xl tracking-tight mb-4">All {s.name} products</h2>
          {s.liveProducts.length === 0 ? (
            <p className="text-ink-400">No live products right now — check back soon.</p>
          ) : (
            <ProductGrid products={s.liveProducts} />
          )}
        </section>
      </div>
    </div>
  );
}

function ProductGrid({ products }: { products: BrandStorefrontProductCard[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {products.map((p) => (
        <Link key={p.id} href={`/p/${p.slug}`}
              className="group ons-card overflow-hidden p-0 transition-transform hover:-translate-y-0.5">
          <div className="aspect-square bg-ink-800 overflow-hidden">
            {p.media[0]?.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.media[0].url} alt={p.title}
                   className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
            ) : null}
          </div>
          <div className="p-4">
            <div className="text-xs uppercase tracking-wider text-ink-400">{p.sellerName}</div>
            <div className="mt-1 line-clamp-2 font-medium text-ink-50">{p.title}</div>
            <div className="mt-2">
              <Money amountMinor={p.basePriceMinor} currency={p.currency as 'USD'} emphasized />
            </div>
            <div className="mt-2">
              <TrustBadge condition={p.condition} size="sm" />
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
