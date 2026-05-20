import * as React from 'react';
import { cn } from '../cn';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent' | 'gold';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

const toneMap: Record<BadgeTone, string> = {
  neutral: 'bg-ink-800 text-ink-100 border border-ink-700',
  success: 'bg-success/15 text-success border border-success/30',
  warning: 'bg-warning/15 text-warning border border-warning/30',
  danger: 'bg-danger/15 text-danger border border-danger/30',
  accent: 'bg-accent-500/15 text-accent-300 border border-accent-500/30',
  gold: 'bg-gold-500/15 text-gold-400 border border-gold-500/30',
};

export function Badge({ tone = 'neutral', className, ...rest }: BadgeProps) {
  return <span className={cn('ons-badge', toneMap[tone], className)} {...rest} />;
}
