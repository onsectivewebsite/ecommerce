import { Injectable } from '@nestjs/common';
import {
  applyRate,
  type TaxContext,
  type TaxLine,
  type TaxRuleRow,
  type TaxStrategy,
} from '../tax.types';

/**
 * India GST.
 *
 * Intra-state sale (seller.region == buyer.region): split equally into CGST + SGST.
 * Inter-state sale (different region or seller outside IN selling into IN): single IGST line.
 *
 * Rule rows are expected to use `jurisdictionType=COUNTRY` with code `IN`; the strategy
 * does the intra/inter split itself based on context.
 */
@Injectable()
export class GstStrategy implements TaxStrategy {
  readonly kind = 'GST' as const;

  apply(ctx: TaxContext, rules: TaxRuleRow[]): TaxLine[] {
    if (ctx.country.toUpperCase() !== 'IN' || rules.length === 0) return [];
    // Take the highest-priority IN rule.
    const rule = rules.slice().sort((a, b) => a.priority - b.priority)[0];
    const intraState =
      !!ctx.sellerCountry &&
      ctx.sellerCountry.toUpperCase() === 'IN' &&
      !!ctx.sellerRegion &&
      !!ctx.region &&
      ctx.sellerRegion.toUpperCase() === ctx.region.toUpperCase();

    if (intraState) {
      const half = Math.round(rule.ratePctMicro / 2);
      const cgst = applyRate(ctx.baseMinor, half);
      const sgst = applyRate(ctx.baseMinor, half);
      return [
        { kind: 'GST', name: 'CGST', jurisdictionCode: 'IN', ratePctMicro: half, amountMinor: cgst, baseMinor: ctx.baseMinor },
        { kind: 'GST', name: 'SGST', jurisdictionCode: ctx.region!.toUpperCase(), ratePctMicro: half, amountMinor: sgst, baseMinor: ctx.baseMinor },
      ];
    }
    const igst = applyRate(ctx.baseMinor, rule.ratePctMicro);
    return [
      { kind: 'GST', name: 'IGST', jurisdictionCode: 'IN', ratePctMicro: rule.ratePctMicro, amountMinor: igst, baseMinor: ctx.baseMinor },
    ];
  }
}
