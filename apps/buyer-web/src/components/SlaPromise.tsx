'use client';

import * as React from 'react';
import type { SlaEstimate } from '@onsective/api-client';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

interface Props {
  productId: string;
}

/**
 * Lightweight client component that fetches a delivery estimate when the
 * buyer is signed in and has a default shipping address. Renders nothing
 * when we don't have enough info to estimate — better than guessing.
 */
export function SlaPromise({ productId }: Props) {
  const { user } = useAuth();
  const [est, setEst] = React.useState<SlaEstimate | null>(null);
  const [country, setCountry] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const addrs = await api.orders.listMyAddresses();
        const def = addrs.find((a) => a.isDefault) ?? addrs[0];
        if (!def || cancelled) return;
        setCountry(def.country);
        const e = await api.sla.estimate({
          productId,
          country: def.country,
          region: def.region,
          qty: 1,
        });
        if (!cancelled) setEst(e);
      } catch { /* swallow — no promise shown */ }
    })();
    return () => { cancelled = true; };
  }, [user, productId]);

  if (!est?.deliverBy) return null;
  const date = new Date(est.deliverBy).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  });
  return (
    <div className="text-xs text-emerald-300">
      Get it by <span className="font-medium">{date}</span>
      {country && <span className="text-ink-400"> · ships to {country}</span>}
    </div>
  );
}
