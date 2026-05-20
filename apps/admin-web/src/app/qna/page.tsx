'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type { ModerationQuestion } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const STATUSES = ['VISIBLE', 'HIDDEN_BY_ADMIN', 'DELETED_BY_AUTHOR'];

function tone(status: string) {
  return status === 'VISIBLE' ? 'success' : 'danger';
}

export default function AdminQnaPage() {
  const { user, loading } = useAuth();
  const [status, setStatus] = React.useState('');
  const [rows, setRows] = React.useState<ModerationQuestion[] | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    api.qna.adminList(status || undefined).then(setRows).catch(() => setRows([]));
  }, [status]);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function hideQuestion(id: string) {
    const reason = prompt('Hide reason:');
    if (!reason) return;
    setBusyId(id);
    try { await api.qna.adminHideQuestion(id, { reason }); load(); }
    finally { setBusyId(null); }
  }
  async function unhideQuestion(id: string) {
    setBusyId(id);
    try { await api.qna.adminUnhideQuestion(id); load(); }
    finally { setBusyId(null); }
  }
  async function hideAnswer(id: string) {
    const reason = prompt('Hide reason:');
    if (!reason) return;
    setBusyId(id);
    try { await api.qna.adminHideAnswer(id, { reason }); load(); }
    finally { setBusyId(null); }
  }
  async function unhideAnswer(id: string) {
    setBusyId(id);
    try { await api.qna.adminUnhideAnswer(id); load(); }
    finally { setBusyId(null); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-3xl tracking-tight">Q&amp;A moderation</h1>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="ons-input">
          <option value="">All</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {!rows ? <div className="text-ink-400">Loading…</div> :
       rows.length === 0 ? <p className="text-ink-400">Nothing to moderate.</p> :
       <div className="space-y-3">
         {rows.map((q) => (
           <div key={q.id} className="ons-card">
             <div className="flex items-center justify-between">
               <div className="text-xs text-ink-400">#{q.id.slice(-8)} · {q.product.title}</div>
               <Badge tone={tone(q.status)}>{q.status}</Badge>
             </div>
             <p className="mt-2 text-ink-100"><span className="text-ink-500 font-semibold">Q </span>{q.body}</p>
             <p className="text-xs text-ink-500 mt-1">{q.askerFirstName}</p>
             <div className="mt-2 flex gap-2">
               {q.status === 'VISIBLE' ? (
                 <button disabled={busyId === q.id} onClick={() => hideQuestion(q.id)} className="ons-btn-ghost text-sm text-danger">Hide question</button>
               ) : q.status === 'HIDDEN_BY_ADMIN' ? (
                 <button disabled={busyId === q.id} onClick={() => unhideQuestion(q.id)} className="ons-btn-ghost text-sm">Unhide question</button>
               ) : null}
             </div>

             {q.answers.length > 0 && (
               <ul className="mt-3 space-y-2 pl-4 border-l border-ink-800">
                 {q.answers.map((a) => (
                   <li key={a.id}>
                     <div className="flex items-center justify-between">
                       <span className="text-xs text-ink-500">{a.authorFirstName} · {a.authorRole}</span>
                       <Badge tone={tone(a.status)}>{a.status}</Badge>
                     </div>
                     <p className="text-sm text-ink-200"><span className="text-accent-400 font-semibold">A </span>{a.body}</p>
                     <div className="mt-1 flex gap-2">
                       {a.status === 'VISIBLE' ? (
                         <button disabled={busyId === a.id} onClick={() => hideAnswer(a.id)} className="ons-btn-ghost text-xs text-danger">Hide answer</button>
                       ) : a.status === 'HIDDEN_BY_ADMIN' ? (
                         <button disabled={busyId === a.id} onClick={() => unhideAnswer(a.id)} className="ons-btn-ghost text-xs">Unhide answer</button>
                       ) : null}
                     </div>
                   </li>
                 ))}
               </ul>
             )}
           </div>
         ))}
       </div>}
    </div>
  );
}
