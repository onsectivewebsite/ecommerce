'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type {
  AdminCollection,
  AdminCollectionDetail,
  CollectionStatus,
} from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const STATUSES: CollectionStatus[] = ['DRAFT', 'ACTIVE', 'ARCHIVED'];

function tone(s: CollectionStatus): 'success' | 'warning' | 'danger' {
  if (s === 'ACTIVE') return 'success';
  if (s === 'DRAFT') return 'warning';
  return 'danger';
}

export default function AdminCollectionsPage() {
  const { user, loading } = useAuth();
  const [rows, setRows] = React.useState<AdminCollection[] | null>(null);
  const [editing, setEditing] = React.useState<AdminCollectionDetail | null>(null);
  const [busy, setBusy] = React.useState(false);

  // create form state
  const [slug, setSlug] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [heroImageUrl, setHeroImageUrl] = React.useState('');
  const [position, setPosition] = React.useState('0');

  // add-item form state (per-editor)
  const [newProductId, setNewProductId] = React.useState('');
  const [newPosition, setNewPosition] = React.useState('0');

  const loadList = React.useCallback(() => {
    api.collections.adminList().then(setRows).catch(() => setRows([]));
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    loadList();
  }, [loading, user, loadList]);

  async function openEditor(id: string) {
    const d = await api.collections.adminGet(id);
    setEditing(d);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.collections.adminCreate({
        slug, title,
        description: description.trim() || undefined,
        heroImageUrl: heroImageUrl.trim() || undefined,
        position: Number(position) || 0,
        status: 'DRAFT',
      });
      setSlug(''); setTitle(''); setDescription(''); setHeroImageUrl(''); setPosition('0');
      loadList();
    } finally { setBusy(false); }
  }

  async function setStatus(c: AdminCollection, status: CollectionStatus) {
    setBusy(true);
    try { await api.collections.adminUpdate(c.id, { status }); loadList(); }
    finally { setBusy(false); }
  }

  async function remove(c: AdminCollection) {
    if (!confirm(`Delete collection "${c.title}"?`)) return;
    setBusy(true);
    try { await api.collections.adminRemove(c.id); loadList(); setEditing(null); }
    finally { setBusy(false); }
  }

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    try {
      const updated = await api.collections.adminAddItem(editing.id, {
        productId: newProductId.trim(),
        position: Number(newPosition) || 0,
      });
      setEditing(updated);
      setNewProductId(''); setNewPosition('0');
      loadList();
    } finally { setBusy(false); }
  }

  async function removeItem(productId: string) {
    if (!editing) return;
    setBusy(true);
    try { setEditing(await api.collections.adminRemoveItem(editing.id, productId)); loadList(); }
    finally { setBusy(false); }
  }

  async function reorderItem(productId: string, pos: number) {
    if (!editing) return;
    setBusy(true);
    try { setEditing(await api.collections.adminReorderItem(editing.id, productId, { position: pos })); }
    finally { setBusy(false); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-10 grid lg:grid-cols-[1fr_1fr] gap-6">
      <div>
        <h1 className="font-display text-3xl tracking-tight mb-6">Collections</h1>

        <form onSubmit={create} className="ons-card mb-6 grid gap-2">
          <h2 className="text-sm uppercase tracking-wider text-ink-400">Create</h2>
          <div className="grid md:grid-cols-2 gap-2">
            <input placeholder="slug (e.g. holiday-gift-guide)" value={slug} onChange={(e) => setSlug(e.target.value)} required className="ons-input text-sm" />
            <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required className="ons-input text-sm" />
          </div>
          <textarea placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={1000} className="ons-input text-sm resize-y" />
          <div className="grid md:grid-cols-2 gap-2">
            <input placeholder="Hero image URL (optional)" value={heroImageUrl} onChange={(e) => setHeroImageUrl(e.target.value)} type="url" className="ons-input text-sm" />
            <input placeholder="Position" value={position} onChange={(e) => setPosition(e.target.value)} type="number" min={0} className="ons-input text-sm" />
          </div>
          <button type="submit" disabled={busy} className="ons-btn-primary self-start text-sm">Create draft</button>
        </form>

        {!rows ? <p className="text-ink-400">Loading…</p> :
         rows.length === 0 ? <p className="text-ink-400">No collections yet.</p> :
         <ul className="space-y-2">
           {rows.map((c) => (
             <li key={c.id} className="ons-card flex items-center justify-between gap-3">
               <div className="min-w-0">
                 <div className="font-medium truncate">{c.title}</div>
                 <div className="text-xs text-ink-500 truncate">/{c.slug} · pos {c.position} · {c.itemCount} item{c.itemCount === 1 ? '' : 's'}</div>
               </div>
               <div className="flex items-center gap-2 shrink-0">
                 <Badge tone={tone(c.status)}>{c.status}</Badge>
                 <button onClick={() => openEditor(c.id)} className="ons-btn-ghost text-sm">Edit</button>
               </div>
             </li>
           ))}
         </ul>}
      </div>

      <div>
        {editing ? (
          <div className="ons-card">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div>
                <h2 className="font-display text-2xl">{editing.title}</h2>
                <div className="text-xs text-ink-500">/{editing.slug} · {editing.itemCount} items</div>
              </div>
              <Badge tone={tone(editing.status)}>{editing.status}</Badge>
            </div>
            <div className="flex flex-wrap gap-2 mb-4">
              {STATUSES.map((s) => (
                <button key={s} disabled={busy || s === editing.status} onClick={() => setStatus(editing, s)} className="ons-btn-ghost text-xs">
                  Set {s}
                </button>
              ))}
              <button onClick={() => remove(editing)} disabled={busy} className="ons-btn-ghost text-xs text-danger">Delete</button>
              <button onClick={() => setEditing(null)} className="ons-btn-ghost text-xs">Close</button>
            </div>

            <h3 className="text-sm uppercase tracking-wider text-ink-400 mt-4 mb-2">Products</h3>
            {editing.items.length === 0 ? <p className="text-ink-400 text-sm">No products yet.</p> :
              <ul className="space-y-1">
                {editing.items.map((it) => (
                  <li key={it.productId} className="flex items-center gap-2 text-sm">
                    <input
                      type="number"
                      min={0}
                      defaultValue={it.position}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (v !== it.position) reorderItem(it.productId, v);
                      }}
                      className="ons-input w-16 text-sm"
                    />
                    <a href={`https://itsnottechy.cloud/p/${it.slug}`} target="_blank" rel="noreferrer" className="text-accent-300 truncate">{it.title}</a>
                    <Badge tone={it.status === 'ACTIVE' ? 'success' : 'warning'}>{it.status}</Badge>
                    <button onClick={() => removeItem(it.productId)} disabled={busy} className="ons-btn-ghost text-xs text-danger ml-auto">Remove</button>
                  </li>
                ))}
              </ul>}

            <form onSubmit={addItem} className="mt-4 flex flex-wrap gap-2 items-end">
              <input placeholder="product id" value={newProductId} onChange={(e) => setNewProductId(e.target.value)} required className="ons-input text-sm flex-1 min-w-[180px]" />
              <input placeholder="position" type="number" min={0} value={newPosition} onChange={(e) => setNewPosition(e.target.value)} className="ons-input text-sm w-24" />
              <button type="submit" disabled={busy} className="ons-btn-secondary text-sm">Add</button>
            </form>
          </div>
        ) : (
          <p className="text-ink-400">Select a collection to edit.</p>
        )}
      </div>
    </div>
  );
}
