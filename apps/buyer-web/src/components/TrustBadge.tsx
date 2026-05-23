import type { ProductCondition } from '@onsective/shared-types';

interface Props {
  condition?: ProductCondition | string;
  brand?: { name: string } | null;
  size?: 'sm' | 'md';
}

// Plain product-condition tags — Amazon-style "New", "Renewed", "Used".
// The previous "Certified Genuine" framing implied a closed curated catalog;
// the platform is now a general marketplace, so condition is a neutral label.
const CONFIG: Record<ProductCondition, { label: string; sub: string; bg: string; ring: string; fg: string } | null> = {
  NEW_GENUINE: null, // don't render a badge for new items — it's the default
  REFURB_GRADE_A: {
    label: 'Renewed',
    sub: 'Grade A · 12-month warranty',
    bg: 'bg-amber-500/15',
    ring: 'ring-amber-500/40',
    fg: 'text-amber-700',
  },
  REFURB_GRADE_B: {
    label: 'Renewed',
    sub: 'Grade B · 6-month warranty',
    bg: 'bg-zinc-500/15',
    ring: 'ring-zinc-500/40',
    fg: 'text-zinc-700',
  },
  REFURB_GRADE_C: {
    label: 'Renewed',
    sub: 'Grade C · 30-day warranty',
    bg: 'bg-orange-500/15',
    ring: 'ring-orange-500/40',
    fg: 'text-orange-700',
  },
  OPEN_BOX: {
    label: 'Open Box',
    sub: 'Inspected · 6-month warranty',
    bg: 'bg-sky-500/15',
    ring: 'ring-sky-500/40',
    fg: 'text-sky-700',
  },
};

export function TrustBadge({ condition, brand, size = 'md' }: Props) {
  if (!condition) return null;
  const cfg = CONFIG[condition as ProductCondition];
  if (!cfg) return null;
  const small = size === 'sm';
  return (
    <div className={[
      'inline-flex items-center gap-2 rounded-lg ring-1',
      cfg.bg, cfg.ring,
      small ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm',
    ].join(' ')}>
      <span className={['font-medium', cfg.fg].join(' ')}>{cfg.label}</span>
      <span className="text-ink-300 text-xs">· {cfg.sub}</span>
      {brand && !small && (
        <span className="text-ink-400 text-xs">· {brand.name}</span>
      )}
    </div>
  );
}
