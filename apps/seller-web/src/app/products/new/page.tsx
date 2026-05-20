'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, CardDescription, CardTitle, Input, Textarea } from '@onsective/ui';
import type { CategoryDto } from '@onsective/shared-types';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

interface VariantRow {
  sku: string;
  name: string;
  priceMajor: string;
  inventoryQty: string;
  weightGrams: string;
}

export default function NewProductPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [cats, setCats] = React.useState<CategoryDto[]>([]);
  const [variants, setVariants] = React.useState<VariantRow[]>([
    { sku: '', name: 'Default', priceMajor: '', inventoryQty: '10', weightGrams: '500' },
  ]);
  const [media, setMedia] = React.useState<string>('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (loading || !user) return;
    api.catalog.listCategories().then(setCats);
  }, [loading, user]);

  function setVariant(idx: number, patch: Partial<VariantRow>) {
    setVariants((vs) => vs.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  }
  function addVariant() {
    setVariants((vs) => [...vs, { sku: '', name: '', priceMajor: '', inventoryQty: '10', weightGrams: '500' }]);
  }
  function removeVariant(idx: number) {
    setVariants((vs) => vs.filter((_, i) => i !== idx));
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData(e.currentTarget);
      const currency = String(fd.get('currency') ?? 'USD').toUpperCase();
      const basePriceMajor = Number(fd.get('basePriceMajor'));
      const hsnCode = String(fd.get('hsnCode') ?? '').trim() || undefined;
      const tariffCountry = String(fd.get('tariffCountry') ?? '').trim().toUpperCase() || undefined;
      const isDigital = fd.get('isDigital') === 'on';
      const minBuyerAgeRaw = String(fd.get('minBuyerAge') ?? '').trim();
      const minBuyerAge = minBuyerAgeRaw ? Number(minBuyerAgeRaw) : undefined;

      const product = await api.seller.createProduct({
        title: String(fd.get('title')),
        description: String(fd.get('description')),
        categorySlug: String(fd.get('categorySlug')),
        currency: currency as any,
        basePriceMinor: Math.round(basePriceMajor * 100),
        status: 'ACTIVE',
        mediaUrls: media.split(/\s+/).map((s) => s.trim()).filter(Boolean),
        variants: variants.map((v) => ({
          sku: v.sku,
          name: v.name,
          priceMinor: Math.round(Number(v.priceMajor) * 100),
          inventoryQty: Number(v.inventoryQty),
          weightGrams: Number(v.weightGrams),
        })),
        hsnCode,
        tariffCountry,
        isDigital,
        minBuyerAge,
      });
      router.push(`/products?created=${product.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally { setBusy(false); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-10 max-w-3xl">
      <h1 className="font-display text-3xl tracking-tight mb-6">New product</h1>
      <form onSubmit={submit} className="space-y-6">
        <Card>
          <CardTitle>Basics</CardTitle>
          <div className="mt-4 grid gap-4">
            <Input label="Title" name="title" required />
            <Textarea label="Description" name="description" required />
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-ink-200">Category</label>
                <select name="categorySlug" className="ons-input" required>
                  {cats.map((c) => (
                    <option key={c.id} value={c.slug} className="bg-ink-900">{c.name}</option>
                  ))}
                </select>
              </div>
              <Input label="Currency" name="currency" defaultValue="USD" maxLength={3} />
            </div>
            <Input label="Base price (e.g. 19.99)" name="basePriceMajor" type="number" step="0.01" required />
            <Textarea label="Media URLs (whitespace-separated)" value={media} onChange={(e) => setMedia(e.target.value)} hint="Phase 1 accepts external image URLs. Native uploads land in Phase 3." />
          </div>
        </Card>

        <Card>
          <CardHeaderRow />
          <div className="mt-4 space-y-3">
            {variants.map((v, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                <Input className="col-span-3" label={idx === 0 ? 'SKU' : ''} value={v.sku} onChange={(e) => setVariant(idx, { sku: e.target.value })} required />
                <Input className="col-span-3" label={idx === 0 ? 'Name' : ''} value={v.name} onChange={(e) => setVariant(idx, { name: e.target.value })} required />
                <Input className="col-span-2" label={idx === 0 ? 'Price' : ''} type="number" step="0.01" value={v.priceMajor} onChange={(e) => setVariant(idx, { priceMajor: e.target.value })} required />
                <Input className="col-span-2" label={idx === 0 ? 'Qty' : ''} type="number" value={v.inventoryQty} onChange={(e) => setVariant(idx, { inventoryQty: e.target.value })} required />
                <Input className="col-span-1" label={idx === 0 ? 'g' : ''} type="number" value={v.weightGrams} onChange={(e) => setVariant(idx, { weightGrams: e.target.value })} required />
                <button type="button" onClick={() => removeVariant(idx)} className="col-span-1 text-danger text-sm" disabled={variants.length === 1}>×</button>
              </div>
            ))}
            <Button type="button" variant="secondary" onClick={addVariant}>+ Variant</Button>
          </div>
        </Card>

        <Card>
          <CardTitle>Customs & compliance</CardTitle>
          <CardDescription>HSN/tariff codes for cross-border shipments. Age gates and digital delivery (configure under "Digital config" after creating).</CardDescription>
          <div className="mt-4 grid grid-cols-12 gap-3">
            <Input className="col-span-4" label="HSN code" name="hsnCode" placeholder="e.g. 6109.10" />
            <Input className="col-span-2" label="Origin (ISO-2)" name="tariffCountry" maxLength={2} placeholder="US" />
            <Input className="col-span-2" label="Min buyer age" name="minBuyerAge" type="number" min={0} max={120} />
            <div className="col-span-4 flex items-center gap-2 mt-7">
              <input id="isDigital" name="isDigital" type="checkbox" className="ons-input w-5 h-5" />
              <label htmlFor="isDigital" className="text-sm">Digital product</label>
            </div>
          </div>
        </Card>

        {err && <p className="text-danger text-sm">{err}</p>}
        <div className="flex gap-2">
          <Button type="submit" loading={busy}>Publish</Button>
          <Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}

function CardHeaderRow() {
  return (
    <div className="flex items-center justify-between">
      <CardTitle>Variants</CardTitle>
      <CardDescription>At least one variant required.</CardDescription>
    </div>
  );
}
