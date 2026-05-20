import * as React from 'react';
import { formatMinor, type CurrencyCode } from '@onsective/shared-types';
import { cn } from '../cn';

export interface MoneyProps extends React.HTMLAttributes<HTMLSpanElement> {
  amountMinor: number;
  currency: CurrencyCode;
  locale?: string;
  emphasized?: boolean;
}

export function Money({ amountMinor, currency, locale, emphasized, className, ...rest }: MoneyProps) {
  return (
    <span
      className={cn(
        'tabular-nums',
        emphasized && 'text-xl font-semibold tracking-tight text-ink-50',
        className,
      )}
      {...rest}
    >
      {formatMinor(amountMinor, currency, locale)}
    </span>
  );
}
