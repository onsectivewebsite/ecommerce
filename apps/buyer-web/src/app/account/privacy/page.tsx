'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type {
  DataExportRequestRow,
  DataExportStatus,
} from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const STATUS_LABEL: Record<DataExportStatus, string> = {
  PENDING: 'Queued',
  BUILDING: 'Building…',
  READY: 'Ready',
  EXPIRED: 'Expired',
  FAILED: 'Failed',
};

const STATUS_TONE: Record<DataExportStatus, string> = {
  PENDING: 'text-ink-300',
  BUILDING: 'text-ink-300',
  READY: 'text-success',
  EXPIRED: 'text-ink-400',
  FAILED: 'text-danger',
};

export default function PrivacyPage() {
  const { user, loading, refresh } = useAuth();
  const router = useRouter();
  const [exports, setExports] = React.useState<DataExportRequestRow[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [downloadingId, setDownloadingId] = React.useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = React.useState(false);
  const [deletionReason, setDeletionReason] = React.useState('');

  const reload = React.useCallback(async () => {
    try {
      setExports(await api.privacy.listMyExports());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  React.useEffect(() => {
    if (loading || !user) return;
    void reload();
  }, [loading, user, reload]);

  async function requestExport() {
    setBusy(true); setError(null);
    try {
      await api.privacy.requestDataExport();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  async function download(id: string) {
    setDownloadingId(id); setError(null);
    try {
      const { url } = await api.privacy.downloadUrl(id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError((e as Error).message);
    } finally { setDownloadingId(null); }
  }

  async function confirmDeletion() {
    setBusy(true); setError(null);
    try {
      await api.privacy.requestDeletion({ reason: deletionReason.trim() || undefined });
      setShowDeleteModal(false);
      setDeletionReason('');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  async function cancelDeletion() {
    setBusy(true); setError(null);
    try {
      await api.privacy.cancelDeletion();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  if (loading) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!user) {
    return (
      <div className="container py-16">
        <Link href="/login?next=/account/privacy" className="ons-btn-primary">Sign in</Link>
      </div>
    );
  }

  const deletionPending = user.deletionStatus === 'REQUESTED';

  return (
    <div className="container py-10 max-w-3xl space-y-8">
      <header>
        <h1 className="font-display text-3xl tracking-tight">Privacy</h1>
        <p className="text-ink-300 mt-2 text-sm">
          Download a copy of your data, or close your account. Closing your account starts a
          30-day grace period — you can restore it any time before then.
        </p>
      </header>

      {error && <div className="ons-card border-danger/40 text-danger">{error}</div>}

      <section className="ons-card space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-medium">Download your data</h2>
            <p className="text-sm text-ink-300 mt-1">
              A JSON archive with your profile, orders, returns, reviews, wallet, points,
              memberships, payment methods, and referrals. Builds in the background and
              expires after 7 days.
            </p>
          </div>
          <button onClick={requestExport} disabled={busy} className="ons-btn-primary">
            {busy ? 'Working…' : 'Request export'}
          </button>
        </div>
        {exports && exports.length > 0 && (
          <ul className="space-y-2 text-sm">
            {exports.map((e) => (
              <li key={e.id} className="border border-ink-800 rounded-lg px-3 py-2 flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</div>
                  <div className="text-xs text-ink-400">
                    Requested {new Date(e.createdAt).toLocaleString()}
                    {e.completedAt && ` · built ${new Date(e.completedAt).toLocaleString()}`}
                    {e.sizeBytes !== null && e.sizeBytes !== undefined && (
                      <> · {(e.sizeBytes / 1024).toFixed(1)} KB</>
                    )}
                    {e.expiresAt && e.status === 'READY' && (
                      <> · expires {new Date(e.expiresAt).toLocaleString()}</>
                    )}
                    {e.error && <span className="text-danger"> · {e.error}</span>}
                  </div>
                </div>
                {e.status === 'READY' && (
                  <button
                    onClick={() => download(e.id)}
                    disabled={downloadingId === e.id}
                    className="ons-btn-secondary text-xs"
                  >
                    {downloadingId === e.id ? 'Opening…' : 'Download'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ons-card space-y-4">
        <div>
          <h2 className="font-medium">Delete your account</h2>
          <p className="text-sm text-ink-300 mt-1">
            Your profile data and addresses will be scrubbed; your order history is retained
            in anonymized form for tax compliance. Your saved cards are detached on Stripe.
            Memberships and points balances are forfeited.
          </p>
        </div>
        {deletionPending ? (
          <div className="border border-warning/40 rounded-lg p-3 bg-warning/5 flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="text-warning font-medium">Deletion scheduled</div>
              <div className="text-xs text-ink-300 mt-1">
                Your account will be deleted on{' '}
                {user.deletionScheduledFor ? new Date(user.deletionScheduledFor).toLocaleString() : 'the scheduled date'}.
                Cancel any time before then to restore full access.
              </div>
            </div>
            <button onClick={cancelDeletion} disabled={busy} className="ons-btn-primary">
              {busy ? 'Working…' : 'Cancel deletion'}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowDeleteModal(true)}
            disabled={busy}
            className="ons-btn-secondary text-danger"
          >
            Delete my account
          </button>
        )}
      </section>

      {showDeleteModal && (
        <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4">
          <div className="ons-card max-w-md w-full space-y-4">
            <h2 className="font-medium">Confirm account deletion</h2>
            <p className="text-sm text-ink-300">
              We'll schedule your account for deletion in 30 days. During that window you can
              sign in and cancel. After 30 days, your profile is anonymized and you'll be
              signed out permanently.
            </p>
            <label className="block">
              <span className="text-xs text-ink-300">Reason (optional)</span>
              <textarea
                value={deletionReason}
                onChange={(e) => setDeletionReason(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Help us improve."
                className="ons-input mt-1"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowDeleteModal(false)} className="ons-btn-ghost">Keep my account</button>
              <button onClick={confirmDeletion} disabled={busy} className="ons-btn-primary bg-danger hover:bg-danger/80">
                {busy ? 'Working…' : 'Schedule deletion'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
