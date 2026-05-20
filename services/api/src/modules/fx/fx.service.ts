import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import type { CurrencyCode } from '@onsective/shared-types';

const SUPPORTED: CurrencyCode[] = [
  'USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'JPY', 'CNY', 'RUB', 'PKR', 'BDT', 'VND',
];

interface ConvertResult {
  amountMinor: number;
  rate: number;
  source: string;
  staleHours: number;
}

@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);
  private readonly base: CurrencyCode;

  constructor(
    private readonly prisma: PrismaService,
    cfg: ConfigService,
  ) {
    this.base = (cfg.get<string>('FX_BASE_CURRENCY') as CurrencyCode) ?? 'USD';
  }

  /**
   * Convert a minor-units amount from one ISO-4217 currency to another. Uses the latest stored
   * rate; falls back to 1:1 if no rate is available (degraded mode). Always returns a non-negative
   * integer of minor units in the target currency, with rounding-half-up.
   */
  async convertMinor(amountMinor: number, from: string, to: string): Promise<ConvertResult> {
    const f = from.toUpperCase();
    const t = to.toUpperCase();
    if (f === t || amountMinor === 0) {
      return { amountMinor, rate: 1, source: 'identity', staleHours: 0 };
    }

    // Walk via the base currency: amount(F) → amount(base) → amount(T)
    const fromBase = f === this.base ? { rate: 1, fetchedAt: new Date() } : await this.lookup(this.base, f);
    const toBase = t === this.base ? { rate: 1, fetchedAt: new Date() } : await this.lookup(this.base, t);

    if (!fromBase || !toBase) {
      this.logger.warn(`FX missing for ${f}↔${t}, falling back to identity`);
      return { amountMinor, rate: 1, source: 'identity-fallback', staleHours: 0 };
    }

    // amount(F) * (1 / rate(base→F)) = amount(base); * rate(base→T) = amount(T)
    const ratio = Number(toBase.rate) / Number(fromBase.rate);
    const converted = Math.round(amountMinor * ratio);
    const oldest = fromBase.fetchedAt < toBase.fetchedAt ? fromBase.fetchedAt : toBase.fetchedAt;
    const staleHours = Math.round((Date.now() - oldest.getTime()) / 3600_000);
    return { amountMinor: converted, rate: ratio, source: 'stored', staleHours };
  }

  async listLatest(): Promise<Array<{ base: string; quote: string; rate: number; fetchedAt: string }>> {
    const rows = await this.prisma.fxRate.findMany({ where: { base: this.base } });
    return rows.map((r) => ({ base: r.base, quote: r.quote, rate: Number(r.rate), fetchedAt: r.fetchedAt.toISOString() }));
  }

  /**
   * Refresh rates from exchangerate.host. Free public API, no API key required.
   * In dev (no internet) the call simply fails and the existing rows remain untouched.
   */
  async refresh(): Promise<{ ok: boolean; updated: number; reason?: string }> {
    const symbols = SUPPORTED.filter((c) => c !== this.base).join(',');
    const url = `https://api.exchangerate.host/latest?base=${this.base}&symbols=${symbols}`;
    let body: any;
    try {
      const res = await fetch(url);
      if (!res.ok) return { ok: false, updated: 0, reason: `HTTP ${res.status}` };
      body = await res.json();
    } catch (e) {
      return { ok: false, updated: 0, reason: (e as Error).message };
    }
    const rates = body?.rates;
    if (!rates || typeof rates !== 'object') {
      return { ok: false, updated: 0, reason: 'malformed response' };
    }
    let updated = 0;
    const now = new Date();
    for (const [quote, rate] of Object.entries(rates)) {
      if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) continue;
      await this.prisma.fxRate.upsert({
        where: { base_quote: { base: this.base, quote } },
        create: { id: newId(), base: this.base, quote, rate: rate.toFixed(8), fetchedAt: now, source: 'exchangerate.host' },
        update: { rate: rate.toFixed(8), fetchedAt: now, source: 'exchangerate.host' },
      });
      updated++;
    }
    this.logger.log(`FX refreshed ${updated} rates from ${this.base}`);
    return { ok: true, updated };
  }

  private async lookup(base: string, quote: string) {
    return this.prisma.fxRate.findUnique({
      where: { base_quote: { base, quote } },
      select: { rate: true, fetchedAt: true },
    });
  }
}
