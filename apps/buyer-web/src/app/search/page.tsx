import { PUBLIC_API_URL } from '@/lib/env';
import { ProductCard } from '@/components/ProductCard';
import { SponsoredRow } from '@/components/SponsoredRow';
import type { PaginatedProducts } from '@onsective/shared-types';

export const dynamic = 'force-dynamic';

interface SearchPayload extends PaginatedProducts {
  source?: 'elasticsearch' | 'postgres';
  suggestion?: string | null;
}

export default async function SearchPage({ searchParams }: { searchParams: { query?: string } }) {
  const q = searchParams.query ?? '';
  // Phase 8: route through /search (ES-backed when ELASTICSEARCH_URL is set,
  // falls back to Postgres ILIKE otherwise — same payload shape either way).
  const url = new URL(`${PUBLIC_API_URL}/search`);
  if (q) url.searchParams.set('query', q);
  url.searchParams.set('pageSize', '40');
  const res = await fetch(url, { cache: 'no-store' });
  const products = (await res.json()) as SearchPayload;
  return (
    <div className="container py-10">
      <h1 className="font-display text-3xl tracking-tight">
        {q ? `Results for "${q}"` : 'All products'}
      </h1>
      <p className="text-ink-400 mt-1 mb-6">
        {products.total} products
        {products.source ? <span className="ml-2 text-ink-500 text-xs">· {products.source}</span> : null}
      </p>
      {products.suggestion && (
        <p className="text-ink-200 mb-4">
          Did you mean{' '}
          <a className="text-accent-300 underline" href={`/search?query=${encodeURIComponent(products.suggestion)}`}>
            {products.suggestion}
          </a>?
        </p>
      )}
      <div className="mb-8"><SponsoredRow type="SEARCH_SPONSOR" q={q} /></div>
      {products.items.length === 0 ? (
        <p className="text-ink-400">No matches. Try a different word.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {products.items.map((p) => (
            <ProductCard key={p.id} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}
