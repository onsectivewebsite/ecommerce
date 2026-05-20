'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type { CertificationKind, CertificationRow } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function SellerCertificationsPage() {
  const { user, loading } = useAuth();
  const [rows, setRows] = React.useState<CertificationRow[] | null>(null);
  const [kind, setKind] = React.useState<CertificationKind>('AUTHORIZED_RESELLER');
  const [note, setNote] = React.useState('');
  const [docs, setDocs] = React.useState<Array<{ url: string; label: string }>>([{ url: '', label: '' }]);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    api.certifications.mine().then(setRows).catch(() => setRows([]));
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      await api.certifications.apply({
        kind,
        applicantNote: note || undefined,
        documents: docs.filter((d) => d.url && d.label),
      });
      setNote(''); setDocs([{ url: '', label: '' }]);
      load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  function setDoc(idx: number, patch: Partial<{ url: string; label: string }>) {
    setDocs((cur) => cur.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }
  function addDoc() { setDocs((cur) => [...cur, { url: '', label: '' }]); }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!rows) return <div className="container py-16 text-ink-400">Loading certifications…</div>;

  return (
    <div className="container py-10 space-y-8">
      <header>
        <h1 className="font-display text-3xl tracking-tight">Certifications</h1>
        <p className="text-sm text-ink-400 mt-1">
          You need an active certification to publish listings on Onsective. Refurbisher status
          additionally enables per-unit refurb listings.
        </p>
      </header>

      <section>
        <h2 className="font-medium mb-3">Apply / re-apply</h2>
        <div className="ons-card space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <select value={kind} onChange={(e) => setKind(e.target.value as CertificationKind)} className="ons-input">
              <option value="AUTHORIZED_RESELLER">Authorized Reseller (new genuine)</option>
              <option value="CERTIFIED_REFURBISHER">Certified Refurbisher</option>
            </select>
          </div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Applicant note (optional)"
                    className="ons-input min-h-[80px]" />
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wider text-ink-400">Supporting documents</label>
            {docs.map((d, idx) => (
              <div key={idx} className="grid sm:grid-cols-[1fr_2fr] gap-2">
                <input value={d.label} onChange={(e) => setDoc(idx, { label: e.target.value })}
                       placeholder="Label (e.g. insurance certificate)" className="ons-input" />
                <input value={d.url} onChange={(e) => setDoc(idx, { url: e.target.value })}
                       placeholder="Document URL" className="ons-input" />
              </div>
            ))}
            <button onClick={addDoc} className="ons-btn-ghost text-xs">+ another document</button>
          </div>
          {err && <div className="text-danger text-sm">{err}</div>}
          <button disabled={busy} onClick={submit} className="ons-btn-primary">
            {busy ? 'Submitting…' : 'Submit application'}
          </button>
        </div>
      </section>

      <section>
        <h2 className="font-medium mb-3">My certifications</h2>
        {rows.length === 0 ? <p className="text-ink-400">No applications yet.</p> : (
          <div className="space-y-2">
            {rows.map((c) => (
              <div key={c.id} className="ons-card flex items-center gap-3">
                <Badge tone={
                  c.status === 'ACTIVE' ? 'success'
                  : c.status === 'PENDING' ? 'warning'
                  : 'danger'
                }>{c.status}</Badge>
                <div className="flex-1">
                  <p className="text-sm font-medium">{c.kind}</p>
                  {c.expiresAt && <p className="text-xs text-ink-400 mt-1">Expires {new Date(c.expiresAt).toLocaleDateString()}</p>}
                  {c.reviewNote && <p className="text-xs text-ink-400 mt-1">Reviewer: {c.reviewNote}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
