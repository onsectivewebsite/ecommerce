'use client';

import * as React from 'react';
import { Badge, Button, Card, CardDescription, CardTitle, Input, Money } from '@onsective/ui';
import type { CurrencyCode, ListingFeeRuleDto, SellerAdminDto } from '@onsective/shared-types';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

interface CategoryRow { id: string; slug: string; name: string }

export default function ListingFeesPage() {
  const { user, loading } = useAuth();
  const [rules, setRules] = React.useState<ListingFeeRuleDto[] | null>(null);
  const [sellers, setSellers] = React.useState<SellerAdminDto[]>([]);
  const [cats, setCats] = React.useState<CategoryRow[]>([]);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);

  const reload = React.useCallback(() => {
    if (!user) return;
    api.admin.listListingFees().then((r) => setRules(r as ListingFeeRuleDto[]));
    api.admin.listSellers().then(setSellers);
    fetch((process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000') + '/catalog/categories')
      .then((r) => r.json()).then((rows) => setCats(rows as CategoryRow[]));
  }, [user]);

  React.useEffect(() => { if (!loading && user) reload(); }, [loading, user, reload]);

  async function createRule(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    const amountMajor = Number(fd.get('amountMajor') ?? 0);
    try {
      await api.admin.createListingFee({
        sellerId: String(fd.get('sellerId')) || null,
        categoryId: String(fd.get('categoryId')) || null,
        amountMinor: Math.round(amountMajor * 100),
        currency: String(fd.get('currency') ?? 'USD'),
        enabled: true,
        note: String(fd.get('note') ?? '') || undefined,
      });
      (e.currentTarget as HTMLFormElement).reset();
      reload();
      setMsg('Rule created');
    } catch (err) { setMsg(err instanceof Error ? err.message : 'Failed'); }
  }

  async function remove(id: string) {
    setBusyId(id);
    try { await api.admin.deleteListingFee(id); reload(); }
    finally { setBusyId(null); }
  }

  async function toggle(rule: ListingFeeRuleDto) {
    setBusyId(rule.id);
    try { await api.admin.updateListingFee(rule.id, { enabled: !rule.enabled }); reload(); }
    finally { setBusyId(null); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;
  if (!rules) return <div className="container py-16 text-ink-400">Loading rules…</div>;

  const sellerName = (id?: string | null) => id ? sellers.find((s) => s.id === id)?.displayName ?? id.slice(-8) : 'any seller';
  const catName    = (id?: string | null) => id ? cats.find((c) => c.id === id)?.name ?? id.slice(-8) : 'any category';

  return (
    <div className="container py-10 space-y-6">
      <header>
        <h1 className="font-display text-3xl tracking-tight">Listing fees</h1>
        <p className="text-ink-400 text-sm">Per-seller / per-category overrides; charged on each new product publish.</p>
      </header>

      <Card>
        <CardTitle>Add rule</CardTitle>
        <CardDescription>
          Leave seller or category blank to apply broadly. More-specific rules win
          (seller+category &gt; seller &gt; category &gt; platform).
        </CardDescription>
        {msg && <p className="text-success text-sm mt-2">{msg}</p>}
        <form onSubmit={createRule} className="mt-4 grid grid-cols-12 gap-3 items-end">
          <div className="col-span-3">
            <label className="text-sm text-ink-200">Seller</label>
            <select name="sellerId" className="ons-input mt-1.5">
              <option value="" className="bg-ink-900">— any seller —</option>
              {sellers.map((s) => <option key={s.id} value={s.id} className="bg-ink-900">{s.displayName}</option>)}
            </select>
          </div>
          <div className="col-span-3">
            <label className="text-sm text-ink-200">Category</label>
            <select name="categoryId" className="ons-input mt-1.5">
              <option value="" className="bg-ink-900">— any category —</option>
              {cats.map((c) => <option key={c.id} value={c.id} className="bg-ink-900">{c.name}</option>)}
            </select>
          </div>
          <Input className="col-span-2" label="Amount" name="amountMajor" type="number" step="0.01" required />
          <Input className="col-span-1" label="Curr." name="currency" defaultValue="USD" maxLength={3} />
          <Input className="col-span-2" label="Note" name="note" />
          <div className="col-span-1"><Button type="submit" fullWidth>Add</Button></div>
        </form>
      </Card>

      <div className="ons-card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-900 text-ink-400">
            <tr>
              <th className="text-left p-3">Scope</th>
              <th className="text-right p-3">Amount</th>
              <th className="text-left p-3">Note</th>
              <th className="text-right p-3">Status</th>
              <th className="text-right p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 ? (
              <tr><td colSpan={5} className="p-6 text-center text-ink-400">No rules yet.</td></tr>
            ) : rules.map((r) => (
              <tr key={r.id} className="border-t border-ink-800">
                <td className="p-3">
                  <div className="font-medium">{sellerName(r.sellerId)}</div>
                  <div className="text-xs text-ink-400">{catName(r.categoryId)}</div>
                </td>
                <td className="p-3 text-right"><Money amountMinor={r.amountMinor} currency={r.currency as CurrencyCode} /></td>
                <td className="p-3 text-ink-300">{r.note ?? '—'}</td>
                <td className="p-3 text-right"><Badge tone={r.enabled ? 'success' : 'neutral'}>{r.enabled ? 'ON' : 'OFF'}</Badge></td>
                <td className="p-3 text-right space-x-2">
                  <Button size="sm" variant="secondary" loading={busyId === r.id} onClick={() => toggle(r)}>{r.enabled ? 'Disable' : 'Enable'}</Button>
                  <Button size="sm" variant="danger" loading={busyId === r.id} onClick={() => remove(r.id)}>Delete</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
