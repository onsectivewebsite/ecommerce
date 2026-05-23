'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type { AdminAnnouncementRow, AnnouncementLevel } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const LEVELS: AnnouncementLevel[] = ['INFO', 'SUCCESS', 'WARNING'];

function localInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminAnnouncementsPage() {
  const { user, loading } = useAuth();
  const [rows, setRows] = React.useState<AdminAnnouncementRow[] | null>(null);
  const [busy, setBusy] = React.useState(false);

  // create form state
  const [title, setTitle] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [level, setLevel] = React.useState<AnnouncementLevel>('INFO');
  const [linkUrl, setLinkUrl] = React.useState('');
  const [linkLabel, setLinkLabel] = React.useState('');
  const [startsAt, setStartsAt] = React.useState(localInput(new Date().toISOString()));
  const [endsAt, setEndsAt] = React.useState('');

  const load = React.useCallback(() => {
    api.announcements.adminList().then(setRows).catch(() => setRows([]));
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.announcements.adminCreate({
        title, message, level,
        linkUrl: linkUrl.trim() || undefined,
        linkLabel: linkLabel.trim() || undefined,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
      });
      setTitle(''); setMessage(''); setLinkUrl(''); setLinkLabel(''); setEndsAt('');
      load();
    } finally { setBusy(false); }
  }

  async function toggleActive(r: AdminAnnouncementRow) {
    setBusy(true);
    try { await api.announcements.adminUpdate(r.id, { isActive: !r.isActive }); load(); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!confirm('Delete this announcement?')) return;
    setBusy(true);
    try { await api.announcements.adminRemove(id); load(); }
    finally { setBusy(false); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-10">
      <h1 className="font-display text-3xl tracking-tight mb-6">Announcements</h1>

      <form onSubmit={create} className="ons-card mb-8 grid gap-3">
        <div className="grid md:grid-cols-2 gap-3">
          <label className="grid gap-1 text-sm">
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} className="ons-input" />
          </label>
          <label className="grid gap-1 text-sm">
            Level
            <select value={level} onChange={(e) => setLevel(e.target.value as AnnouncementLevel)} className="ons-input">
              {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        </div>
        <label className="grid gap-1 text-sm">
          Message
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} required maxLength={1000} rows={2} className="ons-input resize-y" />
        </label>
        <div className="grid md:grid-cols-2 gap-3">
          <label className="grid gap-1 text-sm">
            Link URL (optional)
            <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} type="url" className="ons-input" />
          </label>
          <label className="grid gap-1 text-sm">
            Link label
            <input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} maxLength={80} className="ons-input" />
          </label>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <label className="grid gap-1 text-sm">
            Starts at
            <input value={startsAt} onChange={(e) => setStartsAt(e.target.value)} type="datetime-local" required className="ons-input" />
          </label>
          <label className="grid gap-1 text-sm">
            Ends at (blank = open-ended)
            <input value={endsAt} onChange={(e) => setEndsAt(e.target.value)} type="datetime-local" className="ons-input" />
          </label>
        </div>
        <button type="submit" disabled={busy} className="ons-btn-primary self-start text-sm">Publish announcement</button>
      </form>

      {!rows ? <p className="text-ink-400">Loading…</p> :
       rows.length === 0 ? <p className="text-ink-400">No announcements yet.</p> :
       <div className="space-y-3">
         {rows.map((r) => {
           const now = Date.now();
           const inWindow = new Date(r.startsAt).getTime() <= now && (!r.endsAt || new Date(r.endsAt).getTime() >= now);
           const shown = r.isActive && inWindow;
           return (
             <div key={r.id} className="ons-card">
               <div className="flex items-center justify-between gap-2">
                 <div>
                   <div className="font-medium text-ink-100">{r.title}</div>
                   <div className="text-xs text-ink-500">
                     {r.level} · {new Date(r.startsAt).toLocaleString()} → {r.endsAt ? new Date(r.endsAt).toLocaleString() : 'open-ended'}
                   </div>
                 </div>
                 <Badge tone={shown ? 'success' : r.isActive ? 'warning' : 'danger'}>
                   {shown ? 'Showing now' : r.isActive ? 'Scheduled / ended' : 'Inactive'}
                 </Badge>
               </div>
               <p className="text-ink-200 mt-2 whitespace-pre-wrap">{r.message}</p>
               {r.linkUrl && (
                 <p className="text-xs text-accent-300 mt-1">{r.linkLabel ?? 'Learn more'} → {r.linkUrl}</p>
               )}
               <div className="mt-3 flex gap-2">
                 <button disabled={busy} onClick={() => toggleActive(r)} className="ons-btn-ghost text-sm">
                   {r.isActive ? 'Deactivate' : 'Activate'}
                 </button>
                 <button disabled={busy} onClick={() => remove(r.id)} className="ons-btn-ghost text-sm text-danger">Delete</button>
               </div>
             </div>
           );
         })}
       </div>}
    </div>
  );
}
