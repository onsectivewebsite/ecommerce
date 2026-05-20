import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const DEFAULTS: Record<string, string> = {
  'platform.commission.bps': '1500',
  'platform.flat_shipping.minor': '499',
  'platform.flat_tax.bps': '800',
  'platform.currency': 'USD',
};

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getString(key: string): Promise<string> {
    const row = await this.prisma.adminSetting.findUnique({ where: { key } });
    if (row) return row.value;
    const def = DEFAULTS[key];
    if (def === undefined) {
      this.logger.warn(`Unknown setting ${key}, returning ''`);
      return '';
    }
    return def;
  }

  async getInt(key: string): Promise<number> {
    const v = await this.getString(key);
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  async upsert(key: string, value: string, description?: string) {
    return this.prisma.adminSetting.upsert({
      where: { key },
      update: { value, description },
      create: { key, value, description },
    });
  }

  async list() {
    const rows = await this.prisma.adminSetting.findMany({ orderBy: { key: 'asc' } });
    return rows.map((r) => ({ key: r.key, value: r.value, description: r.description ?? undefined }));
  }
}
