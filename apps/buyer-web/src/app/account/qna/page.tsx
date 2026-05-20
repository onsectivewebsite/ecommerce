'use client';

import * as React from 'react';
import Link from 'next/link';
import { Badge } from '@onsective/ui';
import type { MyQna } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function MyQnaPage() {
  const { user, loading } = useAuth();
  const [data, setData] = React.useState<MyQna | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    api.qna.mine().then(setData).catch(() => setData({ questions: [], answers: [] }));
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function removeQuestion(id: string) {
    if (!confirm('Delete this question?')) return;
    setBusyId(id);
    try { await api.qna.removeQuestion(id); load(); }
    finally { setBusyId(null); }
  }

  async function removeAnswer(id: string) {
    if (!confirm('Delete this answer?')) return;
    setBusyId(id);
    try { await api.qna.removeAnswer(id); load(); }
    finally { setBusyId(null); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-10">
      <h1 className="font-display text-3xl tracking-tight mb-6">My questions &amp; answers</h1>

      <h2 className="text-sm uppercase tracking-wider text-ink-400 mb-3">Questions I asked</h2>
      {!data ? <p className="text-ink-400">Loading…</p> :
        data.questions.length === 0 ? <p className="text-ink-400">You haven&apos;t asked any questions.</p> :
        <ul className="space-y-3">
          {data.questions.map((q) => (
            <li key={q.id} className="ons-card">
              <div className="flex items-center justify-between">
                <Link href={`/p/${q.product.slug}`} className="text-sm text-accent-300">{q.product.title}</Link>
                {q.status !== 'VISIBLE' && <Badge tone="danger">{q.status}</Badge>}
              </div>
              <p className="mt-1 text-ink-100">{q.body}</p>
              <div className="mt-2 flex items-center gap-3 text-xs text-ink-500">
                <span>{q.answerCount} answer{q.answerCount === 1 ? '' : 's'}</span>
                {q.status === 'VISIBLE' && (
                  <button disabled={busyId === q.id} onClick={() => removeQuestion(q.id)} className="text-danger">Delete</button>
                )}
              </div>
            </li>
          ))}
        </ul>}

      <h2 className="text-sm uppercase tracking-wider text-ink-400 mb-3 mt-8">Answers I wrote</h2>
      {!data ? null :
        data.answers.length === 0 ? <p className="text-ink-400">You haven&apos;t answered any questions.</p> :
        <ul className="space-y-3">
          {data.answers.map((a) => (
            <li key={a.id} className="ons-card">
              <div className="flex items-center justify-between">
                <Link href={`/p/${a.question.product.slug}`} className="text-sm text-accent-300">{a.question.product.title}</Link>
                {a.status !== 'VISIBLE' && <Badge tone="danger">{a.status}</Badge>}
              </div>
              <p className="mt-1 text-xs text-ink-500">Q: {a.question.body}</p>
              <p className="mt-1 text-ink-200">{a.body}</p>
              <div className="mt-2 flex items-center gap-3 text-xs text-ink-500">
                <span>{a.helpfulCount} helpful</span>
                {a.status === 'VISIBLE' && (
                  <button disabled={busyId === a.id} onClick={() => removeAnswer(a.id)} className="text-danger">Delete</button>
                )}
              </div>
            </li>
          ))}
        </ul>}
    </div>
  );
}
