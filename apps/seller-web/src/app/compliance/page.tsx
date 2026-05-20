'use client';

import * as React from 'react';
import { Badge, Button, Card, CardDescription, CardTitle, Input } from '@onsective/ui';
import type {
  CategoryComplianceDto,
  SellerComplianceDocDto,
} from '@onsective/shared-types';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const TONES: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  APPROVED: 'success',
  PENDING: 'warning',
  REJECTED: 'danger',
  EXPIRED: 'neutral',
};

export default function SellerCompliancePage() {
  const { user, loading } = useAuth();
  const [rules, setRules] = React.useState<CategoryComplianceDto[]>([]);
  const [docs, setDocs] = React.useState<SellerComplianceDocDto[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  const reload = React.useCallback(() => {
    if (!user) return;
    api.compliance.sellerRules().then(setRules).catch(() => setRules([]));
    api.compliance.myDocs().then(setDocs).catch(() => setDocs([]));
  }, [user]);

  React.useEffect(() => { if (!loading && user) reload(); }, [loading, user, reload]);

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const fd = new FormData(e.currentTarget);
    const file = fd.get('file') as File | null;
    const docType = String(fd.get('docType') ?? '').trim();
    const categoryId = String(fd.get('categoryId') ?? '') || undefined;
    if (!file || !docType) { setBusy(false); return; }

    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const b64 = bufferToBase64(buf);
      await api.compliance.uploadDoc({
        categoryId,
        docType,
        fileBase64: b64,
        fileName: file.name,
      });
      (e.currentTarget as HTMLFormElement).reset();
      setMsg('Uploaded — awaiting admin review.');
      reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Upload failed');
    } finally { setBusy(false); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-10 max-w-4xl space-y-6">
      <header>
        <h1 className="font-display text-3xl tracking-tight">Compliance</h1>
        <p className="text-ink-400 text-sm mt-1">
          Some categories require documentation before listings can be sold. Upload the requested docs;
          admin reviews and either approves or rejects with a reason.
        </p>
      </header>

      <Card>
        <CardTitle>Category requirements</CardTitle>
        <CardDescription>What documentation each restricted category requires.</CardDescription>
        <div className="mt-4 space-y-2">
          {rules.length === 0 ? (
            <p className="text-ink-400 text-sm">No restricted categories — you're good to sell.</p>
          ) : rules.map((r) => (
            <div key={r.id} className="flex items-center justify-between border-b border-ink-800 last:border-0 py-2">
              <div>
                <div className="font-medium">{r.categoryName}</div>
                <div className="text-xs text-ink-400">
                  {r.minBuyerAge ? `Buyer min age ${r.minBuyerAge}` : 'No age restriction'} ·
                  {r.requiresSellerDoc ? ' Doc required' : ' No doc required'}
                  {r.blockedCountries.length > 0 && ` · Blocked: ${r.blockedCountries.join(', ')}`}
                </div>
                {r.notes && <p className="text-ink-300 text-sm mt-1">{r.notes}</p>}
              </div>
              <div className="flex flex-wrap gap-1 max-w-xs justify-end">
                {r.requirementKinds.map((k) => (
                  <Badge key={k} tone="accent">{k}</Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle>Upload document</CardTitle>
        <CardDescription>Accepted: PDF, JPG, PNG. Max 4MB.</CardDescription>
        {msg && <p className="text-success text-sm mt-2">{msg}</p>}
        <form onSubmit={upload} className="mt-4 grid grid-cols-12 gap-3 items-end">
          <Input className="col-span-4" label="Doc type" name="docType" placeholder="e.g. alcohol_license" required />
          <div className="col-span-4">
            <label className="text-sm font-medium text-ink-200">Category</label>
            <select name="categoryId" className="ons-input mt-1.5">
              <option value="" className="bg-ink-900">— sellerwide —</option>
              {rules.map((r) => (
                <option key={r.categoryId} value={r.categoryId} className="bg-ink-900">{r.categoryName}</option>
              ))}
            </select>
          </div>
          <div className="col-span-3">
            <label className="text-sm font-medium text-ink-200">File</label>
            <input name="file" type="file" accept="application/pdf,image/*" required className="ons-input mt-1.5" />
          </div>
          <div className="col-span-1"><Button type="submit" loading={busy}>Upload</Button></div>
        </form>
      </Card>

      <Card>
        <CardTitle>My documents</CardTitle>
        <CardDescription>Status updates from the admin appear here.</CardDescription>
        <div className="mt-4 space-y-2">
          {docs.length === 0 ? (
            <p className="text-ink-400 text-sm">No uploads yet.</p>
          ) : docs.map((d) => (
            <div key={d.id} className="flex items-center justify-between border-b border-ink-800 last:border-0 py-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{d.docType}</span>
                  <Badge tone={TONES[d.status] ?? 'neutral'}>{d.status}</Badge>
                  {d.categorySlug && <span className="text-xs text-ink-400">/{d.categorySlug}</span>}
                </div>
                <div className="text-xs text-ink-400 mt-1">
                  Uploaded {new Date(d.createdAt).toLocaleString()}
                  {d.reviewedAt && ` · Reviewed ${new Date(d.reviewedAt).toLocaleString()}`}
                  {d.expiresAt && ` · Expires ${new Date(d.expiresAt).toLocaleDateString()}`}
                </div>
                {d.rejectionReason && (
                  <p className="text-danger text-sm mt-1">{d.rejectionReason}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function bufferToBase64(buf: Uint8Array): string {
  let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return btoa(s);
}
