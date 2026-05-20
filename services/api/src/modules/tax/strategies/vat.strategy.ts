import { Injectable } from '@nestjs/common';
import {
  applyRate,
  type TaxContext,
  type TaxLine,
  type TaxRuleRow,
  type TaxStrategy,
} from '../tax.types';

const EU_OSS = new Set([
  'AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','FR','GR','HR','HU','IE','IT',
  'LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK',
]);

/**
 * EU VAT (OSS basic).
 *
 * For B2C shipments inside the EU, charge the buyer-country VAT rate. For UK we
 * also apply VAT under the same `VAT` kind (handled as a separate rule row).
 * Per-category reduced rates are supported via `rule.categorySlug`; when present,
 * the strategy applies the rate per matching line and sums the difference
 * (vs. the standard country rule) so receipts itemize the reduced lines.
 */
@Injectable()
export class VatStrategy implements TaxStrategy {
  readonly kind = 'VAT' as const;

  apply(ctx: TaxContext, rules: TaxRuleRow[]): TaxLine[] {
    const country = ctx.country.toUpperCase();
    if (country !== 'GB' && !EU_OSS.has(country)) return [];
    if (rules.length === 0) return [];

    const standard = rules.find(
      (r) => r.jurisdictionType === 'COUNTRY' && r.jurisdictionCode.toUpperCase() === country && !r.categorySlug,
    );
    const reducedRules = rules.filter(
      (r) => r.jurisdictionType === 'COUNTRY' && r.jurisdictionCode.toUpperCase() === country && r.categorySlug,
    );

    const lines: TaxLine[] = [];

    if (reducedRules.length === 0) {
      if (!standard) return [];
      return [
        {
          kind: 'VAT',
          name: standard.name,
          jurisdictionCode: country,
          ratePctMicro: standard.ratePctMicro,
          amountMinor: applyRate(ctx.baseMinor, standard.ratePctMicro),
          baseMinor: ctx.baseMinor,
        },
      ];
    }

    // Mixed: apply per-item.
    let standardBase = ctx.baseMinor;
    for (const item of ctx.items) {
      const reduced = reducedRules.find((r) => r.categorySlug === item.categorySlug);
      if (reduced) {
        standardBase -= item.lineSubtotalMinor;
        lines.push({
          kind: 'VAT',
          name: reduced.name,
          jurisdictionCode: country,
          ratePctMicro: reduced.ratePctMicro,
          amountMinor: applyRate(item.lineSubtotalMinor, reduced.ratePctMicro),
          baseMinor: item.lineSubtotalMinor,
        });
      }
    }
    if (standard && standardBase > 0) {
      lines.push({
        kind: 'VAT',
        name: standard.name,
        jurisdictionCode: country,
        ratePctMicro: standard.ratePctMicro,
        amountMinor: applyRate(standardBase, standard.ratePctMicro),
        baseMinor: standardBase,
      });
    }
    return lines;
  }
}
