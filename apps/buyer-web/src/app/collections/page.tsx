import Link from 'next/link';
import { PUBLIC_API_URL } from '@/lib/env';
import type { CollectionSummary } from '@onsective/api-client';

export const dynamic = 'force-dynamic';

async function fetchCollections(): Promise<CollectionSummary[]> {
  const res = await fetch(`${PUBLIC_API_URL}/collections`, { cache: 'no-store' });
  if (!res.ok) return [];
  return (await res.json()) as CollectionSummary[];
}

export default async function CollectionsIndexPage() {
  const rows = await fetchCollections();
  return (
    <div className="container py-10">
      <h1 className="font-display text-3xl tracking-tight mb-2">Collections</h1>
      <p className="text-ink-400 mb-8">Editor-curated picks across brands.</p>
      {rows.length === 0 ? (
        <p className="text-ink-400">No collections yet.</p>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map((c) => (
            <li key={c.id}>
              <Link
                href={`/collections/${encodeURIComponent(c.slug)}`}
                className="group ons-card overflow-hidden p-0 block hover:-translate-y-0.5 hover:shadow-elev3 transition-transform"
              >
                <div className="aspect-[16/9] bg-ink-800 overflow-hidden">
                  {c.heroImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.heroImageUrl}
                      alt={c.title}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                      loading="lazy"
                    />
                  ) : null}
                </div>
                <div className="p-4">
                  <div className="font-medium text-ink-50">{c.title}</div>
                  {c.description && <div className="text-sm text-ink-400 mt-1 line-clamp-2">{c.description}</div>}
                  <div className="text-xs text-ink-500 mt-2">{c.itemCount} product{c.itemCount === 1 ? '' : 's'}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
