'use client';

import * as React from 'react';
import Link from 'next/link';
import { Badge, Button, Card, CardDescription, CardTitle, Input, Money } from '@onsective/ui';
import type {
  AdBudgetDto,
  AdCampaignDto,
  AdPricingModel,
  CurrencyCode,
} from '@onsective/shared-types';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function AdsPage() {
  const { user, loading } = useAuth();
  const [budget, setBudget] = React.useState<AdBudgetDto | null>(null);
  const [campaigns, setCampaigns] = React.useState<AdCampaignDto[] | null>(null);
  const [showCreate, setShowCreate] = React.useState(false);
  const [showTopUp, setShowTopUp] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const reload = React.useCallback(() => {
    if (!user) return;
    api.ads.budget().then(setBudget).catch(() => undefined);
    api.ads.listCampaigns().then(setCampaigns).catch(() => setCampaigns([]));
  }, [user]);

  React.useEffect(() => { if (!loading && user) reload(); }, [loading, user, reload]);

  async function topUp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const fd = new FormData(e.currentTarget);
    const major = Number(fd.get('amount') ?? 0);
    try {
      await api.ads.topUp(Math.round(major * 100), 'mock');
      setMsg(`Top-up of $${major.toFixed(2)} succeeded`);
      setShowTopUp(false);
      reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Top-up failed');
    } finally { setBusy(false); }
  }

  async function createCampaign(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const fd = new FormData(e.currentTarget);
    try {
      const major = Number(fd.get('bid') ?? 0);
      const c = await api.ads.createCampaign({
        name: String(fd.get('name')),
        pricingModel: String(fd.get('pricingModel')) as AdPricingModel,
        bidMinor: Math.round(major * 100),
        dailyBudgetMinor: Math.round(Number(fd.get('daily') ?? 0) * 100),
        totalBudgetMinor: Math.round(Number(fd.get('total') ?? 0) * 100),
      });
      setMsg(`Created "${c.name}" — add a placement to start serving.`);
      setShowCreate(false);
      reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Create failed');
    } finally { setBusy(false); }
  }

  async function setStatus(c: AdCampaignDto, status: AdCampaignDto['status']) {
    setBusy(true);
    try { await api.ads.updateCampaign(c.id, { status }); reload(); }
    finally { setBusy(false); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-10 space-y-6">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Ads</h1>
          <p className="text-ink-400 text-sm">Promote your products in sponsored slots.</p>
        </div>
        <div className="flex items-center gap-3">
          {budget && (
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-ink-400">Ad balance</div>
              <Money amountMinor={budget.availableMinor} currency={budget.currency as CurrencyCode} emphasized />
            </div>
          )}
          <Button variant="secondary" onClick={() => setShowTopUp((v) => !v)}>Top up</Button>
          <Button onClick={() => setShowCreate((v) => !v)}>+ New campaign</Button>
        </div>
      </header>

      {msg && <p className="text-success text-sm">{msg}</p>}

      {showTopUp && (
        <Card>
          <CardTitle>Top up ad balance</CardTitle>
          <CardDescription>Pre-paid budget — drawn down per click (CPC) or per 1000 impressions (CPM).</CardDescription>
          <form onSubmit={topUp} className="mt-3 flex gap-3 items-end">
            <Input label="Amount (USD)" name="amount" type="number" step="0.01" defaultValue="50" required />
            <Button type="submit" loading={busy}>Charge mock card</Button>
          </form>
        </Card>
      )}

      {showCreate && (
        <Card>
          <CardTitle>New campaign</CardTitle>
          <form onSubmit={createCampaign} className="mt-3 grid grid-cols-12 gap-3 items-end">
            <Input className="col-span-4" label="Name" name="name" required />
            <div className="col-span-2">
              <label className="text-sm font-medium text-ink-200">Model</label>
              <select name="pricingModel" className="ons-input mt-1.5">
                <option value="CPC" className="bg-ink-900">CPC</option>
                <option value="CPM" className="bg-ink-900">CPM</option>
              </select>
            </div>
            <Input className="col-span-2" label="Bid (per click / CPM)" name="bid" type="number" step="0.01" required />
            <Input className="col-span-2" label="Daily cap" name="daily" type="number" step="0.01" defaultValue="0" />
            <Input className="col-span-2" label="Total cap" name="total" type="number" step="0.01" defaultValue="0" />
            <div className="col-span-12"><Button type="submit" loading={busy}>Create</Button></div>
          </form>
        </Card>
      )}

      {!campaigns ? (
        <p className="text-ink-400">Loading campaigns…</p>
      ) : campaigns.length === 0 ? (
        <Card>
          <CardTitle>No campaigns yet</CardTitle>
          <CardDescription>Create one above and add a sponsored-product placement to start serving.</CardDescription>
        </Card>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => (
            <Card key={c.id}>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Link href={`/ads/${c.id}`} className="text-lg font-medium hover:text-accent-200">{c.name}</Link>
                    <Badge tone={c.status === 'ACTIVE' ? 'success' : c.status === 'EXHAUSTED' ? 'danger' : 'neutral'}>{c.status}</Badge>
                    <Badge tone="accent">{c.pricingModel}</Badge>
                  </div>
                  <div className="text-sm text-ink-400 mt-1">
                    Bid <Money amountMinor={c.bidMinor} currency={c.currency as CurrencyCode} />{' · '}
                    Spent <Money amountMinor={c.spentMinor} currency={c.currency as CurrencyCode} />{' · '}
                    {c.placements?.length ?? 0} placement{(c.placements?.length ?? 0) === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="flex gap-2">
                  {c.status !== 'ACTIVE'   && <Button size="sm" loading={busy} onClick={() => setStatus(c, 'ACTIVE')}>Activate</Button>}
                  {c.status === 'ACTIVE'   && <Button size="sm" variant="secondary" loading={busy} onClick={() => setStatus(c, 'PAUSED')}>Pause</Button>}
                  {c.status !== 'ENDED'    && <Button size="sm" variant="ghost" loading={busy} onClick={() => setStatus(c, 'ENDED')}>End</Button>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
