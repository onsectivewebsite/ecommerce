'use client';

import * as React from 'react';
import { Badge } from '@onsective/ui';
import type { CertificationRow } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function AdminCertificationsPage() {
  const { user, loading } = useAuth();
  const [pending, setPending] = React.useState<CertificationRow[] | null>(null);
  const [all, setAll] = React.useState<CertificationRow[]>([]);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<'pending' | 'all'>('pending');

  const load = React.useCallback(async () => {
    try {
      const [p, a] = await Promise.all([
        api.certifications.adminPending(),
        api.certifications.adminList(),
      ]);
      setPending(p);
      setAll(a);
    } catch (e) { setErr((e as Error).message); }
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    load();
  }, [loading, user, load]);

  async function review(id: string, approve: boolean) {
    setBusy(id); setErr(null);
    try {
      const note = approve ? undefined : prompt('Reason for rejection?') ?? undefined;
      await api.certifications.adminReview(id, { approve, reviewNote: note });
      await load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  async function revoke(id: string) {
    const reason = prompt('Reason for revocation?');
    if (!reason) return;
    setBusy(id);
    try {
      await api.certifications.adminRevoke(id, reason);
      await load();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!pending) return <div className="container py-16 text-ink-400">Loading…</div>;

  const rows = tab === 'pending' ? pending : all;

  return (
    <div className="container py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Seller certifications</h1>
          <p className="text-sm text-ink-400 mt-1">
            Review AUTHORIZED_RESELLER and CERTIFIED_REFURBISHER applications.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setTab('pending')} className={tab === 'pending' ? 'ons-btn-primary text-sm' : 'ons-btn-ghost text-sm'}>
            Pending ({pending.length})
          </button>
          <button onClick={() => setTab('all')} className={tab === 'all' ? 'ons-btn-primary text-sm' : 'ons-btn-ghost text-sm'}>
            All ({all.length})
          </button>
        </div>
      </div>

      {err && <div className="text-danger text-sm mb-4">{err}</div>}

      {rows.length === 0 ? (
        <p className="text-ink-400">No certifications in this tab.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((c) => (
            <div key={c.id} className="ons-card">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.seller?.displayName ?? c.sellerId}</span>
                    <Badge tone="neutral">{c.kind}</Badge>
                    <Badge tone={
                      c.status === 'ACTIVE' ? 'success'
                      : c.status === 'PENDING' ? 'warning'
                      : c.status === 'REJECTED' || c.status === 'REVOKED' ? 'danger'
                      : 'neutral'
                    }>{c.status}</Badge>
                  </div>
                  {c.applicantNote && <p className="text-xs text-ink-400 mt-1">Applicant note: {c.applicantNote}</p>}
                  {c.reviewNote && <p className="text-xs text-ink-400 mt-1">Reviewer: {c.reviewNote}</p>}
                  {c.expiresAt && <p className="text-xs text-ink-400 mt-1">Expires {new Date(c.expiresAt).toLocaleDateString()}</p>}
                  {c.documents.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {c.documents.map((d, idx) => (
                        <a key={idx} href={d.url} target="_blank" rel="noreferrer"
                           className="text-xs underline text-gold-400">{d.label}</a>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  {c.status === 'PENDING' && (
                    <>
                      <button disabled={busy === c.id} onClick={() => review(c.id, true)} className="ons-btn-primary text-sm">Approve</button>
                      <button disabled={busy === c.id} onClick={() => review(c.id, false)} className="ons-btn-ghost text-sm">Reject</button>
                    </>
                  )}
                  {c.status === 'ACTIVE' && (
                    <button disabled={busy === c.id} onClick={() => revoke(c.id)} className="ons-btn-ghost text-sm">Revoke</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
