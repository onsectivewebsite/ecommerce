import Link from 'next/link';
import { PUBLIC_API_URL } from '@/lib/env';
import { ProductCard } from '@/components/ProductCard';
import type { CategoryDto, PaginatedProducts } from '@onsective/shared-types';

export const dynamic = 'force-dynamic';

export default async function CategoryPage({ params }: { params: { slug: string } }) {
  const [catRes, prodRes] = await Promise.all([
    fetch(`${PUBLIC_API_URL}/catalog/categories`, { cache: 'no-store' }),
    fetch(`${PUBLIC_API_URL}/catalog/products?category=${encodeURIComponent(params.slug)}&pageSize=24`, { cache: 'no-store' }),
  ]);
  const cats = (await catRes.json()) as CategoryDto[];
  const products = (await prodRes.json()) as PaginatedProducts;
  const cat = cats.find((c) => c.slug === params.slug);
  return (
    <div className="container py-10">
      <div className="text-xs text-ink-400 mb-2">
        <Link href="/">Home</Link> <span className="mx-1">/</span> <span className="text-ink-200">{cat?.name ?? params.slug}</span>
      </div>
      <h1 className="font-display text-3xl tracking-tight">{cat?.name ?? 'Category'}</h1>
      <p className="text-ink-400 mt-1 mb-8">{products.total} products</p>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {products.items.map((p) => (
          <ProductCard key={p.id} p={p} />
        ))}
      </div>
      {products.items.length === 0 && (
        <p className="text-ink-400">Nothing here yet. Check back soon.</p>
      )}
    </div>
  );
}
