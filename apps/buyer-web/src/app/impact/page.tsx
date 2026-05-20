import Link from 'next/link';
import { PUBLIC_API_URL } from '@/lib/env';
import type { PlatformTotalsResult } from '@onsective/api-client';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  return {
    title: 'Our impact — Onsective',
    description: 'Carbon avoided, material diverted, and product lives extended through certified refurbished, open-box, trade-in, and repair on Onsective.',
    alternates: { canonical: '/impact' },
  };
}

const SUBJECT_LABEL: Record<string, string> = {
  REFURB_PURCHASE: 'Certified refurbished purchases',
  OPENBOX_PURCHASE: 'Open-box purchases',
  TRADEIN_PAYOUT: 'Trade-ins accepted',
  REPAIR_COMPLETED: 'Repairs completed',
};

export default async function PublicImpactPage() {
  const res = await fetch(`${PUBLIC_API_URL}/sustainability/platform`, { cache: 'no-store' });
  const empty: PlatformTotalsResult = {
    totals: { kgCo2Saved: 0, kgMaterialDiverted: 0, lifeExtensionYears: 0, events: 0 },
    bySubject: [],
    topBrands90d: [],
  };
  const data = res.ok ? ((await res.json()) as PlatformTotalsResult) : empty;

  return (
    <div className="container py-12 max-w-4xl space-y-12">
      <header>
        <span className="text-[10px] uppercase tracking-[0.18em] text-gold-400">Onsective</span>
        <h1 className="font-display text-4xl tracking-tight mt-2">Our impact</h1>
        <p className="text-sm text-ink-400 mt-2 max-w-2xl">
          Every refurbished purchase, open-box order, trade-in, and successful repair extends
          a product's life and avoids new manufacturing emissions. These are our estimates,
          rounded honestly. We update the underlying factors as better data lands.
        </p>
      </header>

      <section className="grid sm:grid-cols-3 gap-4">
        <StatCard label="kg CO₂ avoided" value={fmt(data.totals.kgCo2Saved, 0)} />
        <StatCard label="kg material diverted" value={fmt(data.totals.kgMaterialDiverted, 1)} />
        <StatCard label="years of product life added" value={fmt(data.totals.lifeExtensionYears, 0)} />
      </section>

      {data.bySubject.length > 0 && (
        <section>
          <h2 className="font-medium mb-4">Where the impact came from</h2>
          <div className="space-y-2">
            {data.bySubject.map((b) => (
              <div key={b.subjectKind} className="ons-card flex items-center gap-3">
                <span className="flex-1">{SUBJECT_LABEL[b.subjectKind] ?? b.subjectKind}</span>
                <span className="text-sm text-ink-400">{b.events} events</span>
                <span className="font-display text-lg">{fmt(b.kgCo2Saved, 0)} kg</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.topBrands90d.length > 0 && (
        <section>
          <h2 className="font-medium mb-4">Top brands by impact (last 90 days)</h2>
          <div className="space-y-2">
            {data.topBrands90d.map((b) => (
              <Link key={b.brandId} href={b.brand ? `/brand/${b.brand.slug}` : '#'}
                    className="ons-card flex items-center gap-3 hover:bg-ink-800/40">
                {b.brand?.logoUrl && <img src={b.brand.logoUrl} alt="" className="w-8 h-8 object-contain rounded bg-ink-800 p-1" />}
                <span className="flex-1 text-sm font-medium">{b.brand?.name ?? b.brandId.slice(-6)}</span>
                <span className="font-display text-lg">{fmt(b.kgCo2Saved, 0)} kg CO₂</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="font-medium mb-3">How we count</h2>
        <p className="text-sm text-ink-400 leading-relaxed">
          Each circular event records a snapshotted estimate using a per-category factor
          (with optional brand override). Numbers shown here are sums of those snapshots.
          We don't recompute history when factors change — the numbers reflect what we
          believed at the moment each event happened. This is not an externally
          certified attestation; we use it to track our own progress and to share with
          buyers and brands what their participation has contributed.
        </p>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="ons-card text-center">
      <p className="text-xs uppercase tracking-wider text-ink-400">{label}</p>
      <p className="font-display text-3xl mt-2">{value}</p>
    </div>
  );
}

function fmt(n: number, decimals: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: 0 });
}
