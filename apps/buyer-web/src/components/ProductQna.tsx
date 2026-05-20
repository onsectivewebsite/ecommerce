'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type { PublicQuestion, QnaAuthorRole } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const ROLE_BADGE: Partial<Record<QnaAuthorRole, { label: string; tone: 'accent' | 'gold' | 'neutral' }>> = {
  SELLER: { label: 'Seller', tone: 'accent' },
  VERIFIED_OWNER: { label: 'Verified owner', tone: 'gold' },
  ADMIN: { label: 'Onsective', tone: 'neutral' },
};

function timeAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function ProductQna({ productId }: { productId: string }) {
  const { user } = useAuth();
  const [items, setItems] = React.useState<PublicQuestion[] | null>(null);
  const [total, setTotal] = React.useState(0);
  const [askBody, setAskBody] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [answerFor, setAnswerFor] = React.useState<string | null>(null);
  const [answerBody, setAnswerBody] = React.useState('');

  const load = React.useCallback(() => {
    api.qna
      .forProduct(productId)
      .then((page) => { setItems(page.items); setTotal(page.total); })
      .catch(() => setItems([]));
  }, [productId]);

  React.useEffect(() => { load(); }, [load]);

  async function submitQuestion(e: React.FormEvent) {
    e.preventDefault();
    if (askBody.trim().length < 5) { setError('Question must be at least 5 characters.'); return; }
    setBusy(true);
    setError(null);
    try {
      await api.qna.ask({ productId, body: askBody.trim() });
      setAskBody('');
      load();
    } catch {
      setError('Could not post your question. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function submitAnswer(questionId: string) {
    if (answerBody.trim().length < 1) return;
    setBusy(true);
    try {
      await api.qna.answer(questionId, { body: answerBody.trim() });
      setAnswerBody('');
      setAnswerFor(null);
      load();
    } catch {
      setError('Could not post your answer. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function vote(answerId: string) {
    if (!user) return;
    try {
      await api.qna.toggleHelpful(answerId);
      load();
    } catch {
      /* ignore — non-critical */
    }
  }

  return (
    <section aria-label="Questions and answers" className="mt-12">
      <h3 className="text-sm uppercase tracking-wider text-ink-400 mb-3">
        Questions &amp; answers{total > 0 ? ` (${total})` : ''}
      </h3>

      <div className="ons-card">
        {user ? (
          <form onSubmit={submitQuestion} className="flex flex-col gap-2">
            <label className="text-sm text-ink-300" htmlFor="qna-ask">Have a question about this product?</label>
            <textarea
              id="qna-ask"
              value={askBody}
              onChange={(e) => setAskBody(e.target.value)}
              maxLength={1000}
              rows={2}
              placeholder="Ask the seller or owners…"
              className="ons-input resize-y"
            />
            <div className="flex items-center gap-3">
              <button type="submit" disabled={busy} className="ons-btn-primary text-sm">Post question</button>
              {error && <span className="text-danger text-sm">{error}</span>}
            </div>
          </form>
        ) : (
          <p className="text-ink-400 text-sm">
            <a href="/login" className="text-accent-300">Sign in</a> to ask a question or answer.
          </p>
        )}
      </div>

      {!items ? (
        <p className="text-ink-400 mt-4">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-ink-400 mt-4">No questions yet. Be the first to ask.</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {items.map((q) => (
            <li key={q.id} className="ons-card">
              <div className="flex items-start gap-2">
                <span className="text-ink-500 font-semibold">Q</span>
                <div className="flex-1">
                  <p className="text-ink-100">{q.body}</p>
                  <p className="text-xs text-ink-500 mt-1">
                    {q.askerFirstName} · {timeAgo(q.createdAt)}
                  </p>
                </div>
              </div>

              {q.answers.length > 0 && (
                <ul className="mt-3 space-y-3 pl-5 border-l border-ink-800">
                  {q.answers.map((a) => {
                    const badge = ROLE_BADGE[a.authorRole];
                    return (
                      <li key={a.id}>
                        <div className="flex items-start gap-2">
                          <span className="text-accent-400 font-semibold">A</span>
                          <div className="flex-1">
                            <p className="text-ink-200">{a.body}</p>
                            <div className="flex items-center gap-2 mt-1 text-xs text-ink-500">
                              <span>{a.authorFirstName}</span>
                              {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
                              <span>· {timeAgo(a.createdAt)}</span>
                              <button
                                type="button"
                                onClick={() => vote(a.id)}
                                disabled={!user}
                                className={`ml-2 ${a.viewerVoted ? 'text-accent-300' : 'text-ink-400 hover:text-ink-200'}`}
                              >
                                ▲ Helpful{a.helpfulCount > 0 ? ` (${a.helpfulCount})` : ''}
                              </button>
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {user && (
                <div className="mt-3 pl-5">
                  {answerFor === q.id ? (
                    <div className="flex flex-col gap-2">
                      <textarea
                        value={answerBody}
                        onChange={(e) => setAnswerBody(e.target.value)}
                        maxLength={4000}
                        rows={2}
                        placeholder="Write an answer…"
                        className="ons-input resize-y"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => submitAnswer(q.id)}
                          className="ons-btn-primary text-sm"
                        >
                          Post answer
                        </button>
                        <button
                          type="button"
                          onClick={() => { setAnswerFor(null); setAnswerBody(''); }}
                          className="ons-btn-ghost text-sm"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setAnswerFor(q.id); setAnswerBody(''); }}
                      className="text-sm text-accent-300"
                    >
                      Answer this question
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
