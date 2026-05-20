'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { Badge } from '@onsective/ui';
import type { BrandCollectionRow, BrandRow } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function BrandStorefrontEditorPage() {
  const params = useParams<{ id: string }>();
  const brandId = params?.id ?? '';
  const { user, loading } = useAuth();

  const [brand, setBrand] = React.useState<BrandRow | null>(null);
  const [collections, setCollections] = React.useState<BrandCollectionRow[] | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const [heroMediaUrl, setHero] = React.useState('');
  const [heroHeadline, setHeadline] = React.useState('');
  const [heroSubcopy, setSubcopy] = React.useState('');
  const [story, setStory] = React.useState('');
  const [accentColor, setAccent] = React.useState('');

  const [attachStore, setAttachStore] = React.useState('');
  const [attachDisplay, setAttachDisplay] = React.useState('');

  const [newCollSlug, setNewCollSlug] = React.useState('');
  const [newCollTitle, setNewCollTitle] = React.useState('');

  const [productEditFor, setProductEditFor] = React.useState<string | null>(null);
  const [productEditRaw, setProductEditRaw] = React.useState('');

  const load = React.useCallback(async () => {
    if (!brandId) return;
    const list = await api.brands.adminList();
    const b = list.find((x) => x.id === brandId) ?? null;
    setBrand(b);
    if (b) {
      setHero(b.heroMediaUrl ?? '');
      setHeadline(b.heroHeadline ?? '');
      setSubcopy(b.heroSubcopy ?? '');
      setStory(b.story ?? '');
      setAccent(b.accentColor ?? '');
    }
    const c = await api.brands.adminListCollections(brandId).catch(() => []);
    setCollections(c);
  }, [brandId]);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function saveStorefront() {
    setBusy('save'); setErr(null);
    try {
      const updated = await api.brands.adminUpdateStorefront(brandId, {
        heroMediaUrl, heroHeadline, heroSubcopy, story, accentColor,
      });
      setBrand(updated);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  async function togglePublish() {
    if (!brand) return;
    setBusy('publish'); setErr(null);
    try {
      const updated = await api.brands.adminUpdateStorefront(brandId, { isPublished: !brand.isPublished });
      setBrand(updated);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  async function attachSeller() {
    setBusy('attach'); setErr(null);
    try {
      const updated = await api.brands.adminAttachSeller(brandId, {
        storeName: attachStore || undefined,
        displayName: attachDisplay || undefined,
      });
      setBrand(updated);
      setAttachStore(''); setAttachDisplay('');
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  async function addCollection() {
    setBusy('add-coll'); setErr(null);
    try {
      await api.brands.adminCreateCollection(brandId, {
        slug: newCollSlug,
        title: newCollTitle,
      });
      setNewCollSlug(''); setNewCollTitle('');
      load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  async function saveCollectionProducts(collectionId: string) {
    setBusy(collectionId); setErr(null);
    try {
      const ids = productEditRaw.split('\n').map((s) => s.trim()).filter(Boolean);
      await api.brands.adminSetCollectionProducts(collectionId, ids);
      setProductEditFor(null);
      load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  async function deleteCollection(collectionId: string) {
    if (!confirm('Delete this collection?')) return;
    setBusy(collectionId);
    try { await api.brands.adminDeleteCollection(collectionId); load(); }
    finally { setBusy(null); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!brand) return <div className="container py-16 text-ink-400">Loading brand…</div>;

  return (
    <div className="container py-10 space-y-10">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl tracking-tight">{brand.name}</h1>
          <p className="text-sm text-ink-400 mt-1">
            Mode <Badge tone="neutral">{brand.mode}</Badge>
            {brand.sellerId && <span className="ml-2 text-xs">seller {brand.sellerId.slice(-8)}</span>}
          </p>
        </div>
        <button onClick={togglePublish} disabled={busy === 'publish'}
                className={brand.isPublished ? 'ons-btn-ghost' : 'ons-btn-primary'}>
          {brand.isPublished ? 'Unpublish' : 'Publish storefront'}
        </button>
      </header>

      {err && <div className="text-danger text-sm">{err}</div>}

      <section className="ons-card space-y-3">
        <h2 className="font-medium">Storefront content</h2>
        <input value={heroMediaUrl} onChange={(e) => setHero(e.target.value)} placeholder="Hero image URL" className="ons-input" />
        <input value={heroHeadline} onChange={(e) => setHeadline(e.target.value)} placeholder="Hero headline" className="ons-input" />
        <textarea value={heroSubcopy} onChange={(e) => setSubcopy(e.target.value)} placeholder="Hero subcopy" className="ons-input min-h-[60px]" />
        <textarea value={story} onChange={(e) => setStory(e.target.value)} placeholder="Brand story (markdown / plain text)" className="ons-input min-h-[160px]" />
        <input value={accentColor} onChange={(e) => setAccent(e.target.value)} placeholder="Accent color (#hex)" className="ons-input max-w-xs" />
        <button onClick={saveStorefront} disabled={busy === 'save'} className="ons-btn-primary">
          {busy === 'save' ? 'Saving…' : 'Save storefront'}
        </button>
      </section>

      {!brand.sellerId && (
        <section className="ons-card space-y-3">
          <h2 className="font-medium">Attach an inventory-holding seller</h2>
          <p className="text-xs text-ink-400">
            Promotes this brand to INVENTORY_HOLDING. A new seller is created (anchored to an admin user)
            and given a 5-year AUTHORIZED_RESELLER certification automatically.
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <input value={attachStore} onChange={(e) => setAttachStore(e.target.value)} placeholder="Store slug (e.g. acme-brand)" className="ons-input" />
            <input value={attachDisplay} onChange={(e) => setAttachDisplay(e.target.value)} placeholder="Display name" className="ons-input" />
          </div>
          <button onClick={attachSeller} disabled={busy === 'attach' || !attachStore || !attachDisplay} className="ons-btn-primary">
            {busy === 'attach' ? 'Attaching…' : 'Attach brand seller'}
          </button>
        </section>
      )}

      <section>
        <h2 className="font-medium mb-3">Collections</h2>
        <div className="ons-card mb-3 grid sm:grid-cols-3 gap-3">
          <input value={newCollSlug} onChange={(e) => setNewCollSlug(e.target.value)} placeholder="Slug" className="ons-input" />
          <input value={newCollTitle} onChange={(e) => setNewCollTitle(e.target.value)} placeholder="Title" className="ons-input" />
          <button disabled={busy === 'add-coll' || !newCollSlug || !newCollTitle} onClick={addCollection} className="ons-btn-primary">
            + Add collection
          </button>
        </div>

        {(collections ?? []).length === 0 ? (
          <p className="text-ink-400">No collections yet.</p>
        ) : (
          <div className="space-y-2">
            {(collections ?? []).map((c) => (
              <div key={c.id} className="ons-card">
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <p className="font-medium text-sm">{c.title} <code className="text-xs text-ink-400">/{c.slug}</code></p>
                    <p className="text-xs text-ink-400 mt-1">{c.products.length} product(s)</p>
                  </div>
                  <button onClick={() => {
                    const same = productEditFor === c.id;
                    setProductEditFor(same ? null : c.id);
                    if (!same) {
                      setProductEditRaw(c.products.map((p) => p.productId).join('\n'));
                    }
                  }} className="ons-btn-ghost text-xs">
                    {productEditFor === c.id ? 'Close' : 'Edit products'}
                  </button>
                  <button onClick={() => deleteCollection(c.id)} className="ons-btn-ghost text-xs">Delete</button>
                </div>
                {productEditFor === c.id && (
                  <div className="mt-3 border-t border-ink-800 pt-3 space-y-2">
                    <p className="text-xs text-ink-400">One product ID per line; order is preserved.</p>
                    <textarea value={productEditRaw} onChange={(e) => setProductEditRaw(e.target.value)}
                              className="ons-input font-mono text-xs min-h-[120px]" />
                    <button disabled={busy === c.id} onClick={() => saveCollectionProducts(c.id)} className="ons-btn-primary text-xs">
                      Save products
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
