import { Injectable } from '@nestjs/common';
import {
  applyRate,
  type TaxContext,
  type TaxLine,
  type TaxRuleRow,
  type TaxStrategy,
} from '../tax.types';

/**
 * Canada HST / GST + PST.
 *
 * Some provinces use harmonized HST (ON 13%, NB/NL/NS/PEI 15%). Others split
 * federal 5% GST + provincial PST (BC 7%, SK 6%, QC ≈9.975%, MB 7%). Rules are
 * authored as REGION rows with the appropriate kind so the strategy can simply
 * sum what the admin configured. If only a COUNTRY=CA row exists we apply that
 * as a fallback federal-only rate.
 */
@Injectable()
export class HstStrategy implements TaxStrategy {
  readonly kind = 'HST' as const;

  apply(ctx: TaxContext, rules: TaxRuleRow[]): TaxLine[] {
    if (ctx.country.toUpperCase() !== 'CA' || rules.length === 0) return [];
    const regionRules = rules.filter(
      (r) => r.jurisdictionType === 'REGION' && ctx.region && r.jurisdictionCode.toUpperCase() === ctx.region.toUpperCase(),
    );
    const countryRules = rules.filter((r) => r.jurisdictionType === 'COUNTRY');
    const applicable = (regionRules.length > 0 ? regionRules : countryRules)
      .filter((r) => r.enabled)
      .sort((a, b) => a.priority - b.priority);
    return applicable.map((r) => ({
      kind: 'HST',
      name: r.name,
      jurisdictionCode: r.jurisdictionType === 'REGION' ? r.jurisdictionCode.toUpperCase() : 'CA',
      ratePctMicro: r.ratePctMicro,
      amountMinor: applyRate(ctx.baseMinor, r.ratePctMicro),
      baseMinor: ctx.baseMinor,
    }));
  }
}
