import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { GstStrategy } from './strategies/gst.strategy';
import { HstStrategy } from './strategies/hst.strategy';
import { VatStrategy } from './strategies/vat.strategy';
import { SalesStrategy } from './strategies/sales.strategy';
import { ConsumptionStrategy } from './strategies/consumption.strategy';
import {
  applyRate,
  type TaxContext,
  type TaxKind,
  type TaxLine,
  type TaxRuleRow,
  type TaxStrategy,
} from './tax.types';

interface ResolveResult {
  totalMinor: number;
  lines: TaxLine[];
  /** True when no jurisdictional rule matched — caller should know it's the flat fallback. */
  fallback: boolean;
}

@Injectable()
export class TaxEngine {
  private readonly logger = new Logger(TaxEngine.name);
  private readonly strategies: Map<TaxKind, TaxStrategy>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    gst: GstStrategy,
    hst: HstStrategy,
    vat: VatStrategy,
    sales: SalesStrategy,
    consumption: ConsumptionStrategy,
  ) {
    this.strategies = new Map<TaxKind, TaxStrategy>([
      ['GST', gst], ['HST', hst], ['VAT', vat], ['SALES', sales], ['CONSUMPTION', consumption],
    ]);
  }

  async resolveForOrder(ctx: TaxContext): Promise<ResolveResult> {
    const country = ctx.country.toUpperCase();
    const region = ctx.region?.toUpperCase();

    // Fetch every rule that could possibly apply — country-level OR matching region OR
    // matching postal prefix. We let the strategy do the final filtering.
    const candidates: TaxRuleRow[] = (await this.prisma.taxRule.findMany({
      where: {
        enabled: true,
        OR: [
          { jurisdictionType: 'COUNTRY', jurisdictionCode: country },
          ...(region ? [{ jurisdictionType: 'REGION', jurisdictionCode: region }] as const : []),
          ...(ctx.postalCode ? [{ jurisdictionType: 'POSTAL_PREFIX' }] as const : []),
        ],
      },
    })) as unknown as TaxRuleRow[];

    if (candidates.length === 0) {
      const flatBps = Number(await this.settings.getInt('platform.flat_tax.bps'));
      const amount = Math.round((ctx.baseMinor * flatBps) / 10000);
      const lines: TaxLine[] = amount > 0 ? [{
        kind: 'NONE',
        name: 'Default tax',
        jurisdictionCode: country || 'GLOBAL',
        ratePctMicro: flatBps * 100, // bps → micro-pct
        amountMinor: amount,
        baseMinor: ctx.baseMinor,
      }] : [];
      return { totalMinor: amount, lines, fallback: true };
    }

    // Group by kind and ask each strategy.
    const byKind = new Map<TaxKind, TaxRuleRow[]>();
    for (const r of candidates) {
      const arr = byKind.get(r.kind) ?? [];
      arr.push(r);
      byKind.set(r.kind, arr);
    }

    const lines: TaxLine[] = [];
    for (const [kind, rules] of byKind.entries()) {
      const strat = this.strategies.get(kind);
      if (!strat) continue;
      lines.push(...strat.apply(ctx, rules));
    }

    const totalMinor = lines.reduce((s, l) => s + l.amountMinor, 0);
    return { totalMinor, lines, fallback: lines.length === 0 };
  }

  /** Helper for the receipt UI when no strategy matched but the flat fallback was used. */
  flatLineForBase(baseMinor: number, country: string, flatBpsMicro: number): TaxLine {
    return {
      kind: 'NONE',
      name: 'Default tax',
      jurisdictionCode: country.toUpperCase() || 'GLOBAL',
      ratePctMicro: flatBpsMicro,
      amountMinor: applyRate(baseMinor, flatBpsMicro),
      baseMinor,
    };
  }
}
