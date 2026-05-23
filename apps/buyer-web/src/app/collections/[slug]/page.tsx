import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PUBLIC_API_URL } from '@/lib/env';
import { ProductCard } from '@/components/ProductCard';
import type { PublicCollection } from '@onsective/api-client';
import type { ProductSummaryDto } from '@onsective/shared-types';

export const dynamic = 'force-dynamic';

async function fetchCollection(slug: string): Promise<PublicCollection | null> {
  const res = await fetch(`${PUBLIC_API_URL}/collections/${encodeURIComponent(slug)}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return (await res.json()) as PublicCollection;
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const c = await fetchCollection(params.slug);
  if (!c) return { title: 'Collection | Onsective' };
  return {
    title: `${c.title} | Onsective`,
    description: c.description ?? `Curated products in ${c.title}.`,
  };
}

export default async function CollectionPage({ params }: { params: { slug: string } }) {
  const c = await fetchCollection(params.slug);
  if (!c) notFound();

  // Map the collection product shape onto ProductSummaryDto for ProductCard.
  const products: ProductSummaryDto[] = c.products.map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    currency: p.currency as ProductSummaryDto['currency'],
    basePriceMinor: p.basePriceMinor,
    sellerName: p.sellerName,
    condition: p.condition as ProductSummaryDto['condition'],
    brand: p.brand,
    media: p.media,
    // categorySlug / status are not exposed by the collection endpoint and
    // are not rendered by ProductCard either; cast to satisfy the type.
  } as ProductSummaryDto));

  return (
    <div>
      <div className="w-full bg-ink-900 border-b border-ink-800">
        {c.heroImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.heroImageUrl} alt={c.title} className="w-full max-h-72 object-cover" />
        )}
        <div className="container py-8">
          <h1 className="font-display text-3xl tracking-tight">{c.title}</h1>
          {c.description && (
            <p className="text-ink-300 mt-2 max-w-2xl whitespace-pre-line">{c.description}</p>
          )}
          <p className="text-xs text-ink-500 mt-2">{products.length} product{products.length === 1 ? '' : 's'}</p>
        </div>
      </div>
      <div className="container py-10">
        {products.length === 0 ? (
          <p className="text-ink-400">No products in this collection.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {products.map((p) => <ProductCard key={p.id} p={p} />)}
          </div>
        )}
      </div>
    </div>
  );
}
