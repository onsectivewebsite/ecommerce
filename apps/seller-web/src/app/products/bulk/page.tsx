'use client';

import * as React from 'react';
import { Badge, Button, Card, CardDescription, CardTitle, Textarea } from '@onsective/ui';
import type { BulkImportReportDto } from '@onsective/shared-types';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { PUBLIC_API_URL } from '@/lib/env';

const SAMPLE = [
  'title,description,category_slug,currency,base_price_minor,sku,variant_name,variant_price_minor,inventory_qty,weight_grams,media_urls',
  'Polaris Wool Beanie,Soft merino beanie,fashion,USD,2900,PWB-CHA-M,Charcoal · M,2900,40,160,https://images.unsplash.com/photo-1576566588028-4147f3842f27',
  'Atlas Travel Mug,Vacuum-insulated 12 oz mug,home-living,USD,3500,ATM-12-BLK,Black 12oz,3500,30,400,https://images.unsplash.com/photo-1517048676732-d65bc937f952',
].join('\n');

export default function BulkImportPage() {
  const { user, loading } = useAuth();
  const [csv, setCsv] = React.useState(SAMPLE);
  const [report, setReport] = React.useState<BulkImportReportDto | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  async function run(dryRun: boolean) {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.seller.bulkImport(csv, dryRun);
      setReport(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Import failed');
    } finally { setBusy(false); }
  }

  if (loading || !user) return <div className="container py-16 text-ink-400">Loading…</div>;

  return (
    <div className="container py-10 max-w-5xl space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl tracking-tight">Bulk import</h1>
          <p className="text-ink-400 text-sm">CSV with one row per variant. PRO+ tier required.</p>
        </div>
        <a
          href={`${PUBLIC_API_URL}/seller/products/bulk-import/template`}
          className="ons-btn-secondary"
        >
          Download template
        </a>
      </header>

      <Card>
        <CardTitle>CSV body</CardTitle>
        <CardDescription>Paste your CSV. We'll validate first; commit only after you confirm.</CardDescription>
        <div className="mt-4">
          <Textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            className="font-mono text-xs"
            rows={12}
          />
        </div>
        {err && <p className="text-danger text-sm mt-2">{err}</p>}
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" onClick={() => run(true)} loading={busy}>Dry-run validate</Button>
          <Button
            onClick={() => run(false)}
            loading={busy}
            disabled={!report || report.errorCount > 0}
          >
            Publish {report ? `${report.okCount} valid rows` : ''}
          </Button>
        </div>
      </Card>

      {report && (
        <Card>
          <CardTitle>{report.dryRun ? 'Dry-run report' : 'Import result'}</CardTitle>
          <CardDescription>
            {report.total} rows · {report.okCount} ok · {report.errorCount} errors
          </CardDescription>
          <div className="mt-4 space-y-1.5 text-sm">
            {report.rows.map((r) => (
              <div key={r.row} className="flex items-center gap-3">
                <span className="text-ink-500 w-10 tabular-nums">#{r.row}</span>
                <Badge tone={r.status === 'ok' ? 'success' : 'danger'}>{r.status}</Badge>
                <span className="text-ink-200 flex-1">
                  {r.title ?? r.slug ?? '—'}
                </span>
                {r.message && <span className="text-danger text-xs">{r.message}</span>}
                {r.slug && <span className="text-ink-400 text-xs">/{r.slug}</span>}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
