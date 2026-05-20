import Link from 'next/link';
import { PUBLIC_API_URL } from '@/lib/env';
import { ProductCard } from '@/components/ProductCard';
import { SponsoredRow } from '@/components/SponsoredRow';
import type { CategoryDto, PaginatedProducts } from '@onsective/shared-types';

async function loadHome() {
  const [catRes, prodRes] = await Promise.all([
    fetch(`${PUBLIC_API_URL}/catalog/categories`, { cache: 'no-store' }),
    fetch(`${PUBLIC_API_URL}/catalog/products?pageSize=12`, { cache: 'no-store' }),
  ]);
  const categories = catRes.ok ? ((await catRes.json()) as CategoryDto[]) : [];
  const products = prodRes.ok ? ((await prodRes.json()) as PaginatedProducts) : { items: [], total: 0, page: 1, pageSize: 12 };
  return { categories, products };
}

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const { categories, products } = await loadHome();
  return (
    <div>
      <section className="relative overflow-hidden border-b border-ink-800">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(60%_60%_at_20%_20%,rgba(37,99,255,0.18),transparent),radial-gradient(60%_60%_at_80%_80%,rgba(212,169,63,0.12),transparent)]" />
        <div className="container py-20 md:py-28 grid md:grid-cols-2 gap-10 items-center">
          <div className="animate-slide-up">
            <p className="text-xs uppercase tracking-[0.2em] text-gold-400">A new kind of marketplace</p>
            <h1 className="mt-3 font-display text-4xl md:text-6xl font-semibold tracking-tight text-ink-50">
              Discover what the rest of the world is making.
            </h1>
            <p className="mt-5 text-ink-300 text-lg max-w-prose">
              Onsective is a curated, global marketplace of premium independent sellers — paid fairly, shipped reliably, and presented beautifully.
            </p>
            <div className="mt-7 flex gap-3">
              <Link href="/search" className="ons-btn-primary">Shop new arrivals</Link>
              <Link href="/register" className="ons-btn-secondary">Sell on Onsective</Link>
            </div>
          </div>
          <div className="hidden md:block">
            <div className="grid grid-cols-2 gap-3">
              {products.items.slice(0, 4).map((p) => (
                <Link key={p.id} href={`/p/${p.slug}`} className="ons-card p-0 overflow-hidden">
                  {p.media[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.media[0].url} alt={p.title} className="aspect-square w-full object-cover" />
                  ) : (
                    <div className="aspect-square bg-ink-800" />
                  )}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="container py-12">
        <div className="flex items-end justify-between gap-4 mb-6">
          <div>
            <h2 className="font-display text-2xl tracking-tight">Featured categories</h2>
            <p className="text-sm text-ink-400">Hand-picked entry points into the catalog.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {categories.map((c) => (
            <Link
              key={c.id}
              href={`/c/${c.slug}`}
              className="ons-card text-center font-medium hover:border-accent-500/60 transition-colors"
            >
              {c.name}
            </Link>
          ))}
        </div>
      </section>

      <section className="container py-8">
        <SponsoredRow type="SPONSORED_PRODUCT" />
      </section>

      <section className="container py-12">
        <div className="flex items-end justify-between gap-4 mb-6">
          <div>
            <h2 className="font-display text-2xl tracking-tight">Trending now</h2>
            <p className="text-sm text-ink-400">Most-loved products this week.</p>
          </div>
          <Link href="/search" className="text-sm text-accent-300 hover:text-accent-200">
            Browse all →
          </Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {products.items.map((p) => (
            <ProductCard key={p.id} p={p} />
          ))}
        </div>
      </section>
    </div>
  );
}
