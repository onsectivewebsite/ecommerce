'use client';

import * as React from 'react';
import { Badge, Button, Card, CardDescription, CardTitle, Input } from '@onsective/ui';
import type {
  CategoryComplianceDto,
  CategoryDto,
  ComplianceRequirementKind,
  SellerComplianceDocDto,
} from '@onsective/shared-types';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const KINDS: ComplianceRequirementKind[] = [
  'AGE_GATE',
  'ID_VERIFICATION',
  'LICENSE_DOC',
  'JURISDICTION_RESTRICTED',
  'DIGITAL_LICENSE',
];

export default function AdminCompliancePage() {
  const { user, loading } = useAuth();
  const [cats, setCats] = React.useState<CategoryDto[]>([]);
  const [rules, setRules] = React.useState<CategoryComplianceDto[]>([]);
  const [docs, setDocs] = React.useState<SellerComplianceDocDto[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [editingCatId, setEditingCatId] = React.useState<string>('');
  const [draft, setDraft] = React.useState<{
    minBuyerAge: string;
    requiresSellerDoc: boolean;
    requirementKinds: Set<ComplianceRequirementKind>;
    blockedCountries: string;
    allowedCountries: string;
    notes: string;
  }>({
    minBuyerAge: '',
    requiresSellerDoc: false,
    requirementKinds: new Set(),
    blockedCountries: '',
    allowedCountries: '',
    notes: '',
  });

  const reload = React.useCallback(() => {
    api.catalog.listCategories().then(setCats).catch(() => setCats([]));
    api.compliance.adminListRules().then(setRules).catch(() => setRules([]));
    api.compliance.adminListPendingDocs().then(setDocs).catch(() => setDocs([]));
  }, []);

  React.useEffect(() => { if (!loading && user) reload(); }, [loading, user, reload]);

  function startEdit(categoryId: string) {
    setEditingCatId(categoryId);
    const existing = rules.find((r) => r.categoryId === categoryId);
    setDraft({
      minBuyerAge: existing?.minBuyerAge?.toString() ?? '',
      requiresSellerDoc: existing?.requiresSellerDoc ?? false,
      requirementKinds: new Set(existing?.requirementKinds ?? []),
      blockedCountries: (existing?.blockedCountries ?? []).join(', '),
      allowedCountries: (existing?.allowedCountries ?? []).join(', '),
      notes: existing?.notes ?? '',
    });
  }

  function toggleKind(k: ComplianceRequirementKind) {
    setDraft((d) => {
      const next = new Set(d.requirementKinds);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return { ...d, requirementKinds: next };
    });
  }

  async function saveRule() {
    if (!editingCatId) return;
    setBusy(true); setMsg(null);
    try {
      await api.compliance.adminUpsertRule(editingCatId, {
        minBuyerAge: draft.minBuyerAge ? Number(draft.minBuyerAge) : null,
        requiresSellerDoc: draft.requiresSellerDoc,
        requirementKinds: [...draft.requirementKinds],
        blockedCountries: draft.blockedCountries.split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.toUpperCase()),
        allowedCountries: draft.allowedCountries.split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.toUpperCase()),
        notes: draft.notes || null,
      });
      setMsg('Rule saved.');
      setEditingCatId('');
      reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Save failed');
    } finally { setBusy(false); }
  }

  async function deleteRule(categoryId: string) {
    if (!confirm('Remove all compliance rules for this category?')) return;
    setBusy(true);
    try { await api.compliance.adminDeleteRule(categoryId); reload(); }
    finally { setBusy(false); }
  }

  async function review(id: string, approve: boolean) {
    setBusy(true); setMsg(null);
    try {
      const reason = approve ? undefined : window.prompt('Rejection reason?') ?? undefined;
      if (!approve && !reason) { setBusy(false); return; }
      await api.compliance.adminReviewDoc(id, { approve, rejectionReason: reason });
      reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Review failed');
    } finally { setBusy(false); }
  }

  async function viewDoc(id: string) {
    const { url } = await api.compliance.adminViewDocUrl(id);
    if (url) window.open(url, '_blank');
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-10 space-y-6">
      <header>
        <h1 className="font-display text-3xl tracking-tight">Compliance</h1>
        <p className="text-ink-400 text-sm mt-1">Category rules and seller document review.</p>
      </header>

      {msg && <p className="text-success text-sm">{msg}</p>}

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardTitle>Category rules</CardTitle>
          <CardDescription>Per-category restrictions enforced at PDP, cart, and checkout.</CardDescription>
          <div className="mt-4 space-y-2">
            {cats.map((c) => {
              const rule = rules.find((r) => r.categoryId === c.id);
              return (
                <div key={c.id} className="flex items-center justify-between border-b border-ink-800 last:border-0 py-2">
                  <div>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-ink-400">
                      {rule
                        ? <>
                            {rule.minBuyerAge ? `Min age ${rule.minBuyerAge}` : 'No age'}
                            {rule.requiresSellerDoc && ' · Doc required'}
                            {rule.blockedCountries.length > 0 && ` · Blocked ${rule.blockedCountries.length}`}
                            {rule.allowedCountries.length > 0 && ` · Allowed ${rule.allowedCountries.length}`}
                          </>
                        : 'No restrictions'}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => startEdit(c.id)}>Edit</Button>
                    {rule && <Button size="sm" variant="ghost" loading={busy} onClick={() => deleteRule(c.id)}>Clear</Button>}
                  </div>
                </div>
              );
            })}
          </div>

          {editingCatId && (
            <div className="mt-6 border-t border-ink-800 pt-4 space-y-3">
              <CardTitle>Edit rule</CardTitle>
              <div className="grid grid-cols-12 gap-3">
                <Input className="col-span-3" label="Min buyer age" type="number" value={draft.minBuyerAge}
                  onChange={(e) => setDraft({ ...draft, minBuyerAge: e.target.value })} />
                <div className="col-span-9 flex items-center gap-2 mt-7">
                  <input
                    id="reqDoc"
                    type="checkbox"
                    checked={draft.requiresSellerDoc}
                    onChange={(e) => setDraft({ ...draft, requiresSellerDoc: e.target.checked })}
                    className="ons-input w-5 h-5"
                  />
                  <label htmlFor="reqDoc">Require seller compliance doc</label>
                </div>
                <div className="col-span-12">
                  <label className="text-sm font-medium text-ink-200">Requirement kinds</label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {KINDS.map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => toggleKind(k)}
                        className={[
                          'ons-btn px-3 py-1 text-xs border',
                          draft.requirementKinds.has(k)
                            ? 'border-accent-500 bg-accent-500/10 text-ink-50'
                            : 'border-ink-700 bg-ink-900 hover:bg-ink-800',
                        ].join(' ')}
                      >
                        {k}
                      </button>
                    ))}
                  </div>
                </div>
                <Input className="col-span-6" label="Blocked countries (ISO-2, comma)" value={draft.blockedCountries}
                  onChange={(e) => setDraft({ ...draft, blockedCountries: e.target.value })} placeholder="IN, PK, SA" />
                <Input className="col-span-6" label="Allowed countries (empty = all-except-blocked)" value={draft.allowedCountries}
                  onChange={(e) => setDraft({ ...draft, allowedCountries: e.target.value })} placeholder="US, CA, GB" />
                <div className="col-span-12">
                  <label className="text-sm font-medium text-ink-200">Notes (visible to sellers)</label>
                  <textarea
                    value={draft.notes}
                    onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                    className="ons-input mt-1.5 min-h-[80px]"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={saveRule} loading={busy}>Save rule</Button>
                <Button variant="ghost" onClick={() => setEditingCatId('')}>Cancel</Button>
              </div>
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>Pending seller documents</CardTitle>
          <CardDescription>{docs.length} awaiting review.</CardDescription>
          <div className="mt-4 space-y-2">
            {docs.length === 0 ? (
              <p className="text-ink-400 text-sm">Nothing to review.</p>
            ) : docs.map((d) => (
              <div key={d.id} className="border-b border-ink-800 last:border-0 py-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{d.docType}</div>
                    <div className="text-xs text-ink-400">
                      {d.sellerName} {d.categorySlug && `· /${d.categorySlug}`} · {Math.round(d.fileSizeBytes / 1024)} KB
                    </div>
                  </div>
                  <Badge tone="warning">{d.status}</Badge>
                </div>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => viewDoc(d.id)}>View</Button>
                  <Button size="sm" loading={busy} onClick={() => review(d.id, true)}>Approve</Button>
                  <Button size="sm" variant="ghost" loading={busy} onClick={() => review(d.id, false)}>Reject</Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
