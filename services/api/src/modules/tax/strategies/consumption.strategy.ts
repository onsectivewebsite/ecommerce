import { Injectable } from '@nestjs/common';
import {
  applyRate,
  type TaxContext,
  type TaxLine,
  type TaxRuleRow,
  type TaxStrategy,
} from '../tax.types';

/**
 * Japan Consumption Tax (Shōhizei).
 *
 * Single nationwide rate (currently 10%; food and some essentials at 8%). Rule
 * authored as COUNTRY=JP. If a category-specific rule exists it overrides the
 * general one for matching items, à la the VAT-reduced path.
 */
@Injectable()
export class ConsumptionStrategy implements TaxStrategy {
  readonly kind = 'CONSUMPTION' as const;

  apply(ctx: TaxContext, rules: TaxRuleRow[]): TaxLine[] {
    if (ctx.country.toUpperCase() !== 'JP' || rules.length === 0) return [];
    const standard = rules.find((r) => !r.categorySlug);
    const reducedRules = rules.filter((r) => !!r.categorySlug);

    if (reducedRules.length === 0) {
      if (!standard) return [];
      return [{
        kind: 'CONSUMPTION',
        name: standard.name,
        jurisdictionCode: 'JP',
        ratePctMicro: standard.ratePctMicro,
        amountMinor: applyRate(ctx.baseMinor, standard.ratePctMicro),
        baseMinor: ctx.baseMinor,
      }];
    }

    const lines: TaxLine[] = [];
    let standardBase = ctx.baseMinor;
    for (const item of ctx.items) {
      const reduced = reducedRules.find((r) => r.categorySlug === item.categorySlug);
      if (reduced) {
        standardBase -= item.lineSubtotalMinor;
        lines.push({
          kind: 'CONSUMPTION',
          name: reduced.name,
          jurisdictionCode: 'JP',
          ratePctMicro: reduced.ratePctMicro,
          amountMinor: applyRate(item.lineSubtotalMinor, reduced.ratePctMicro),
          baseMinor: item.lineSubtotalMinor,
        });
      }
    }
    if (standard && standardBase > 0) {
      lines.push({
        kind: 'CONSUMPTION',
        name: standard.name,
        jurisdictionCode: 'JP',
        ratePctMicro: standard.ratePctMicro,
        amountMinor: applyRate(standardBase, standard.ratePctMicro),
        baseMinor: standardBase,
      });
    }
    return lines;
  }
}
