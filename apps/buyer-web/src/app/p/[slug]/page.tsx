import type { Metadata } from 'next';
import { PUBLIC_API_URL } from '@/lib/env';
import type { ProductDetailDto, ProductCondition } from '@onsective/shared-types';
import type { RefurbUnitRow } from '@onsective/api-client';
import { ProductBuyBox } from '@/components/ProductBuyBox';
import { RecommendationsRow } from '@/components/RecommendationsRow';
import { TrustBadge } from '@/components/TrustBadge';
import { RefurbUnitPicker } from '@/components/RefurbUnitPicker';
import { JsonLd } from '@/components/JsonLd';

export const dynamic = 'force-dynamic';

const BUYER_ORIGIN = process.env.NEXT_PUBLIC_BUYER_URL ?? 'http://localhost:3000';

const CONDITION_SCHEMA: Record<ProductCondition, string> = {
  NEW_GENUINE: 'https://schema.org/NewCondition',
  REFURB_GRADE_A: 'https://schema.org/RefurbishedCondition',
  REFURB_GRADE_B: 'https://schema.org/RefurbishedCondition',
  REFURB_GRADE_C: 'https://schema.org/RefurbishedCondition',
  OPEN_BOX: 'https://schema.org/UsedCondition',
};

async function fetchProduct(slug: string): Promise<ProductDetailDto | null> {
  const res = await fetch(
    `${PUBLIC_API_URL}/catalog/products/${encodeURIComponent(slug)}`,
    { cache: 'no-store' },
  );
  if (!res.ok) return null;
  return (await res.json()) as ProductDetailDto;
}

function trimDescription(s: string, max = 160): string {
  const oneLine = s.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1).trimEnd() + '…';
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const p = await fetchProduct(params.slug);
  if (!p) return { title: 'Product | Onsective' };
  const url = `${BUYER_ORIGIN}/p/${encodeURIComponent(p.slug)}`;
  const image = p.media[0]?.url;
  const description = trimDescription(p.description);
  return {
    title: `${p.title} | Onsective`,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: p.title,
      description,
      url,
      type: 'website',
      images: image ? [{ url: image, alt: p.title }] : undefined,
      siteName: 'Onsective',
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title: p.title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function ProductPage({ params }: { params: { slug: string } }) {
  const p = await fetchProduct(params.slug);
  if (!p) {
    return <div className="container py-16 text-ink-400">Product not found.</div>;
  }
  const isRefurb = p.condition && p.condition !== 'NEW_GENUINE';
  let refurbUnits: RefurbUnitRow[] = [];
  if (isRefurb) {
    const r = await fetch(`${PUBLIC_API_URL}/refurb-units/by-product/${p.id}`, { cache: 'no-store' });
    if (r.ok) refurbUnits = (await r.json()) as RefurbUnitRow[];
  }

  const canonical = `${BUYER_ORIGIN}/p/${encodeURIComponent(p.slug)}`;
  const itemCondition = p.condition ? CONDITION_SCHEMA[p.condition] : null;
  // Refurb products list per-unit prices; the cheapest available unit is
  // the "from" price. NEW_GENUINE uses basePriceMinor directly.
  const cheapestUnit = isRefurb
    ? [...refurbUnits].filter((u) => u.availability === 'AVAILABLE').sort((a, b) => a.priceMinor - b.priceMinor)[0]
    : null;
  const priceMinor = cheapestUnit?.priceMinor ?? p.basePriceMinor;
  const productJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.title,
    description: p.description,
    sku: p.slug,
    image: p.media.map((m) => m.url),
    category: p.categorySlug,
    offers: {
      '@type': 'Offer',
      url: canonical,
      priceCurrency: p.currency,
      price: (priceMinor / 100).toFixed(2),
      availability:
        isRefurb
          ? cheapestUnit
            ? 'https://schema.org/InStock'
            : 'https://schema.org/OutOfStock'
          : 'https://schema.org/InStock',
      ...(itemCondition ? { itemCondition } : {}),
    },
  };
  if (p.brand) {
    productJsonLd.brand = {
      '@type': 'Brand',
      name: p.brand.name,
      ...(p.brand.logoUrl ? { logo: p.brand.logoUrl } : {}),
    };
  }

  return (
    <div className="container py-10">
      <JsonLd data={productJsonLd} />
      <div className="mb-4">
        <TrustBadge condition={p.condition} brand={p.brand} />
      </div>
      <div className="grid md:grid-cols-2 gap-10">
        <div className="grid gap-3">
          {p.media.length > 0 ? (
            p.media.map((m) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={m.id} src={m.url} alt={m.alt ?? p.title} className="ons-card p-0 w-full aspect-square object-cover" />
            ))
          ) : (
            <div className="ons-card p-0 aspect-square bg-ink-800" />
          )}
        </div>
        <div className="space-y-4">
          <ProductBuyBox product={p} />
          {isRefurb && <RefurbUnitPicker product={p} units={refurbUnits} />}
        </div>
      </div>
      <div className="mt-12 grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 ons-card">
          <h3 className="text-sm uppercase tracking-wider text-ink-400 mb-3">Description</h3>
          <p className="text-ink-200 whitespace-pre-line leading-relaxed">{p.description}</p>
        </div>
        <div className="ons-card">
          <h3 className="text-sm uppercase tracking-wider text-ink-400 mb-3">Sold by</h3>
          <p className="text-ink-100 font-medium">{p.sellerName}</p>
          <p className="text-ink-400 text-sm mt-1">Ships in 2-3 business days.</p>
        </div>
      </div>

      <RecommendationsRow productId={p.id} type="fbt" />
      <RecommendationsRow productId={p.id} type="similar" />
    </div>
  );
}
