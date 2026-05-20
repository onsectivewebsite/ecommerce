import { Injectable } from '@nestjs/common';
import {
  applyRate,
  type TaxContext,
  type TaxLine,
  type TaxRuleRow,
  type TaxStrategy,
} from '../tax.types';

/**
 * US Sales tax (origin-based, simple).
 *
 * Real US sales tax is destination-based with nexus rules per state, but Phase 6
 * keeps it simple: a REGION rule keyed on the buyer's US state is the rate that
 * gets charged. POSTAL_PREFIX rules win over REGION (city/county adders).
 * Sellers without nexus rules in a state pay nothing for that state.
 */
@Injectable()
export class SalesStrategy implements TaxStrategy {
  readonly kind = 'SALES' as const;

  apply(ctx: TaxContext, rules: TaxRuleRow[]): TaxLine[] {
    if (ctx.country.toUpperCase() !== 'US' || !ctx.region) return [];
    const region = ctx.region.toUpperCase();
    const postal = ctx.postalCode ?? '';
    const matches = rules.filter((r) => {
      if (!r.enabled) return false;
      if (r.jurisdictionType === 'POSTAL_PREFIX') return postal.startsWith(r.jurisdictionCode);
      if (r.jurisdictionType === 'REGION') return r.jurisdictionCode.toUpperCase() === region;
      return false;
    });
    if (matches.length === 0) return [];
    return matches
      .sort((a, b) => a.priority - b.priority)
      .map((r) => ({
        kind: 'SALES',
        name: r.name,
        jurisdictionCode: r.jurisdictionType === 'POSTAL_PREFIX' ? r.jurisdictionCode : region,
        ratePctMicro: r.ratePctMicro,
        amountMinor: applyRate(ctx.baseMinor, r.ratePctMicro),
        baseMinor: ctx.baseMinor,
      }));
  }
}
