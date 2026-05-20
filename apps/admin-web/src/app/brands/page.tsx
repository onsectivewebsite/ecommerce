'use client';

import * as React from 'react';
import Link from 'next/link';
import { Badge } from '@onsective/ui';
import type { BrandRow, BrandAuthorizationRow } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function AdminBrandsPage() {
  const { user, loading } = useAuth();
  const [rows, setRows] = React.useState<BrandRow[] | null>(null);
  const [showCreate, setShowCreate] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const [slug, setSlug] = React.useState('');
  const [name, setName] = React.useState('');
  const [logoUrl, setLogoUrl] = React.useState('');
  const [contactEmail, setContactEmail] = React.useState('');
  const [categories, setCategories] = React.useState('');

  const [openAuthFor, setOpenAuthFor] = React.useState<string | null>(null);
  const [auths, setAuths] = React.useState<BrandAuthorizationRow[]>([]);
  const [authSellerId, setAuthSellerId] = React.useState('');
  const [authCategory, setAuthCategory] = React.useState('');
  const [authExpires, setAuthExpires] = React.useState('');
  const [authNote, setAuthNote] = React.useState('');

  const load = React.useCallback(() => {
    api.brands.adminList().then(setRows).catch(() => setRows([]));
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function create() {
    setCreating(true); setErr(null);
    try {
      await api.brands.adminCreate({
        slug,
        name,
        logoUrl: logoUrl || undefined,
        contactEmail: contactEmail || undefined,
        categorySlugs: categories.split(',').map((s) => s.trim()).filter(Boolean),
      });
      setShowCreate(false);
      setSlug(''); setName(''); setLogoUrl(''); setContactEmail(''); setCategories('');
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally { setCreating(false); }
  }

  async function openAuth(brandId: string) {
    setOpenAuthFor((cur) => (cur === brandId ? null : brandId));
    if (openAuthFor !== brandId) {
      const list = await api.brands.adminListAuthorizations(brandId).catch(() => []);
      setAuths(list);
    }
  }

  async function authorize(brandId: string) {
    setErr(null);
    try {
      await api.brands.authorize({
        sellerId: authSellerId,
        brandId,
        categorySlug: authCategory,
        expiresAt: new Date(authExpires).toISOString(),
        note: authNote || undefined,
      });
      const list = await api.brands.adminListAuthorizations(brandId);
      setAuths(list);
      setAuthSellerId(''); setAuthCategory(''); setAuthExpires(''); setAuthNote('');
    } catch (e) { setErr((e as Error).message); }
  }

  async function revoke(authId: string, brandId: string) {
    if (!confirm('Revoke this authorization?')) return;
    await api.brands.revokeAuthorization(authId);
    const list = await api.brands.adminListAuthorizations(brandId);
    setAuths(list);
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!rows) return <div className="container py-16 text-ink-400">Loading brands…</div>;

  return (
    <div className="container py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Brands</h1>
          <p className="text-sm text-ink-400 mt-1">
            Authorize sellers to publish NEW_GENUINE listings for brand+category pairs.
          </p>
        </div>
        <button onClick={() => setShowCreate((v) => !v)} className="ons-btn-primary text-sm">
          {showCreate ? 'Cancel' : '+ New brand'}
        </button>
      </div>

      {showCreate && (
        <div className="ons-card mb-6 space-y-3">
          <h2 className="font-medium">New brand</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="Slug (e.g. apple)" className="ons-input" />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" className="ons-input" />
            <input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="Logo URL" className="ons-input sm:col-span-2" />
            <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="Contact email" className="ons-input" />
            <input value={categories} onChange={(e) => setCategories(e.target.value)} placeholder="Allowed categories (comma-separated slugs)" className="ons-input" />
          </div>
          {err && <div className="text-danger text-sm">{err}</div>}
          <button disabled={creating || !slug || !name} onClick={create} className="ons-btn-primary">
            {creating ? 'Creating…' : 'Create brand'}
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-ink-400">No brands yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((b) => (
            <div key={b.id} className="ons-card">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    {b.logoUrl && <img src={b.logoUrl} alt="" className="w-6 h-6 object-contain rounded" />}
                    <span className="font-medium">{b.name}</span>
                    <code className="text-xs text-ink-400">/{b.slug}</code>
                  </div>
                  <div className="text-xs text-ink-400 mt-1">
                    {b._count?.products ?? 0} products · {b._count?.authorizations ?? 0} authorizations
                    {b.categorySlugs.length > 0 && ` · ${b.categorySlugs.join(', ')}`}
                  </div>
                </div>
                {b.isPublished && <Badge tone="success">PUBLISHED</Badge>}
                <Badge tone="neutral">{b.mode}</Badge>
                <Link href={`/brands/${b.id}/storefront`} className="ons-btn-ghost text-sm">Storefront</Link>
                <button onClick={() => openAuth(b.id)} className="ons-btn-ghost text-sm">
                  {openAuthFor === b.id ? 'Hide' : 'Manage auths'}
                </button>
              </div>

              {openAuthFor === b.id && (
                <div className="mt-4 border-t border-ink-800 pt-4 space-y-3">
                  <div className="grid sm:grid-cols-5 gap-2">
                    <input value={authSellerId} onChange={(e) => setAuthSellerId(e.target.value)} placeholder="Seller ID" className="ons-input" />
                    <input value={authCategory} onChange={(e) => setAuthCategory(e.target.value)} placeholder="Category slug" className="ons-input" />
                    <input type="date" value={authExpires} onChange={(e) => setAuthExpires(e.target.value)} className="ons-input" />
                    <input value={authNote} onChange={(e) => setAuthNote(e.target.value)} placeholder="Note (optional)" className="ons-input" />
                    <button
                      disabled={!authSellerId || !authCategory || !authExpires}
                      onClick={() => authorize(b.id)}
                      className="ons-btn-primary text-sm"
                    >Authorize</button>
                  </div>
                  {auths.length === 0 ? (
                    <p className="text-sm text-ink-400">No authorizations yet.</p>
                  ) : (
                    <div className="space-y-1">
                      {auths.map((a) => (
                        <div key={a.id} className="flex items-center gap-3 text-sm">
                          <code className="text-xs text-ink-400 flex-1">
                            seller={a.seller?.displayName ?? a.sellerId} · cat={a.categorySlug} · exp {new Date(a.expiresAt).toLocaleDateString()}
                          </code>
                          <button onClick={() => revoke(a.id, b.id)} className="ons-btn-ghost text-xs">Revoke</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
