'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type { ModerationQuestion } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function SellerQnaPage() {
  const { user, loading } = useAuth();
  const [rows, setRows] = React.useState<ModerationQuestion[] | null>(null);
  const [answerFor, setAnswerFor] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    api.qna.listForSeller().then(setRows).catch(() => setRows([]));
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function submit(questionId: string) {
    if (draft.trim().length < 1) return;
    setBusy(true);
    try {
      await api.qna.sellerAnswer(questionId, { body: draft.trim() });
      setDraft('');
      setAnswerFor(null);
      load();
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-10">
      <h1 className="font-display text-3xl tracking-tight mb-6">Product Q&amp;A</h1>
      {!rows ? <div className="text-ink-400">Loading…</div> :
       rows.length === 0 ? <p className="text-ink-400">No questions on your products yet.</p> :
       <div className="space-y-3">
         {rows.map((q) => (
           <div key={q.id} className="ons-card">
             <div className="flex items-center justify-between">
               <span className="text-sm text-accent-300">{q.product.title}</span>
               <Badge tone={q.answerCount === 0 ? 'warning' : 'success'}>
                 {q.answerCount === 0 ? 'Unanswered' : `${q.answerCount} answer${q.answerCount === 1 ? '' : 's'}`}
               </Badge>
             </div>
             <p className="mt-2 text-ink-100"><span className="text-ink-500 font-semibold">Q </span>{q.body}</p>
             <p className="text-xs text-ink-500 mt-1">{q.askerFirstName}</p>

             {q.answers.length > 0 && (
               <ul className="mt-2 space-y-2 pl-4 border-l border-ink-800">
                 {q.answers.map((a) => (
                   <li key={a.id} className="text-sm">
                     <span className="text-accent-400 font-semibold">A </span>
                     <span className="text-ink-200">{a.body}</span>
                     <span className="text-xs text-ink-500"> — {a.authorFirstName} ({a.authorRole})</span>
                   </li>
                 ))}
               </ul>
             )}

             <div className="mt-3">
               {answerFor === q.id ? (
                 <div className="flex flex-col gap-2">
                   <textarea
                     value={draft}
                     onChange={(e) => setDraft(e.target.value)}
                     maxLength={4000}
                     rows={2}
                     placeholder="Answer as the seller…"
                     className="ons-input resize-y"
                   />
                   <div className="flex gap-2">
                     <button disabled={busy} onClick={() => submit(q.id)} className="ons-btn-primary text-sm">Post answer</button>
                     <button onClick={() => { setAnswerFor(null); setDraft(''); }} className="ons-btn-ghost text-sm">Cancel</button>
                   </div>
                 </div>
               ) : (
                 <button onClick={() => { setAnswerFor(q.id); setDraft(''); }} className="text-sm text-accent-300">
                   Answer this question
                 </button>
               )}
             </div>
           </div>
         ))}
       </div>}
    </div>
  );
}
