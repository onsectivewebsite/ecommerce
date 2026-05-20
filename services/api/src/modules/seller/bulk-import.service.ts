import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { ListingFeesService } from '../listing-fees/listing-fees.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

export interface BulkRowReport {
  row: number;
  status: 'ok' | 'error';
  message?: string;
  productId?: string;
  slug?: string;
  title?: string;
}

export interface BulkImportReport {
  dryRun: boolean;
  total: number;
  okCount: number;
  errorCount: number;
  rows: BulkRowReport[];
}

interface ParsedRow {
  index: number;
  raw: Record<string, string>;
}

const TEMPLATE_HEADERS = [
  'title',
  'description',
  'category_slug',
  'currency',
  'base_price_minor',
  'sku',
  'variant_name',
  'variant_price_minor',
  'inventory_qty',
  'weight_grams',
  'media_urls',
];

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines: string[][] = [];
  let cur: string[] = [];
  let buf = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { buf += '"'; i++; }
        else inQuotes = false;
      } else {
        buf += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { cur.push(buf); buf = ''; }
      else if (ch === '\r') { /* skip */ }
      else if (ch === '\n') { cur.push(buf); lines.push(cur); cur = []; buf = ''; }
      else buf += ch;
    }
  }
  if (buf.length > 0 || cur.length > 0) { cur.push(buf); lines.push(cur); }
  if (lines.length === 0) return { headers: [], rows: [] };
  const headerLine = lines[0] ?? [];
  const headers = headerLine.map((h) => h.trim().toLowerCase());
  const rows: Record<string, string>[] = [];
  for (let r = 1; r < lines.length; r++) {
    const row = lines[r] ?? [];
    if (row.length === 1 && row[0] === '') continue;
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = (row[i] ?? '').trim(); });
    rows.push(obj);
  }
  return { headers, rows };
}

@Injectable()
export class BulkImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fees: ListingFeesService,
    private readonly subs: SubscriptionsService,
  ) {}

  template(): string {
    return TEMPLATE_HEADERS.join(',') + '\n';
  }

  async import(userId: string, csvText: string, dryRun: boolean): Promise<BulkImportReport> {
    await this.subs.requireFeature(userId, 'bulkImport');
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) throw new NotFoundException('No seller profile');
    if (seller.status !== 'APPROVED') throw new BadRequestException('Seller must be APPROVED');

    const { headers, rows: parsed } = parseCsv(csvText);
    if (parsed.length === 0) {
      return { dryRun, total: 0, okCount: 0, errorCount: 0, rows: [] };
    }
    const missing = TEMPLATE_HEADERS.filter((h) => !headers.includes(h));
    if (missing.length) {
      throw new BadRequestException(`CSV missing headers: ${missing.join(', ')}`);
    }

    const rowsTyped: ParsedRow[] = parsed.map((r, idx) => ({ index: idx + 2, raw: r }));
    const report: BulkRowReport[] = [];

    // Phase 1 of validation: structural.
    const sluggable = new Map<string, number>(); // sku → row index, detect dup-in-file
    for (const { index, raw } of rowsTyped) {
      const issue = this.validateRow(raw);
      if (issue) { report.push({ row: index, status: 'error', message: issue }); continue; }
      const sku = raw.sku!;
      if (sluggable.has(sku)) {
        report.push({ row: index, status: 'error', message: `sku duplicated in file (also row ${sluggable.get(sku)})` });
        continue;
      }
      sluggable.set(sku, index);
      report.push({ row: index, status: 'ok', title: raw.title });
    }

    // Phase 2: external constraints (category exists, sku not already in DB).
    const categories = new Map<string, string>();
    for (const r of report) {
      if (r.status !== 'ok') continue;
      const raw = rowsTyped.find((x) => x.index === r.row)!.raw;
      const catSlug = raw.category_slug!;
      if (!categories.has(catSlug)) {
        const cat = await this.prisma.category.findUnique({ where: { slug: catSlug } });
        if (!cat) { r.status = 'error'; r.message = `unknown category_slug ${catSlug}`; continue; }
        categories.set(catSlug, cat.id);
      }
      const skuClash = await this.prisma.productVariant.findUnique({ where: { sku: raw.sku! } });
      if (skuClash) { r.status = 'error'; r.message = `sku already in catalog`; continue; }
    }

    const ok = report.filter((r) => r.status === 'ok');
    const err = report.filter((r) => r.status === 'error');

    if (dryRun) {
      return { dryRun, total: report.length, okCount: ok.length, errorCount: err.length, rows: report };
    }
    if (err.length > 0) {
      // Per spec: if any row fails, no writes happen.
      return { dryRun, total: report.length, okCount: 0, errorCount: err.length, rows: report };
    }

    // Capacity check up-front: don't half-publish then hit the cap.
    const sub = await this.subs.getMine(userId);
    const existing = await this.prisma.product.count({
      where: { sellerId: seller.id, status: { in: ['ACTIVE', 'DRAFT'] } },
    });
    const maxAllowed = sub.definition.features.maxActiveProducts;
    if (maxAllowed !== -1 && existing + ok.length > maxAllowed) {
      throw new BadRequestException(`Tier ${sub.tier} allows ${maxAllowed} products; would exceed by ${existing + ok.length - maxAllowed}`);
    }

    // One TX per product so a downstream failure doesn't roll back peers.
    for (const r of ok) {
      const raw = rowsTyped.find((x) => x.index === r.row)!.raw;
      const categoryId = categories.get(raw.category_slug!)!;
      const slug = await this.uniqueSlug(raw.title!);
      try {
        const created = await this.prisma.product.create({
          data: {
            id: newId(),
            sellerId: seller.id,
            categoryId,
            slug,
            title: raw.title!,
            description: raw.description ?? '',
            currency: (raw.currency || 'USD').toUpperCase(),
            basePriceMinor: Number(raw.base_price_minor),
            status: 'ACTIVE',
            attributes: {},
            variants: {
              create: [{
                id: newId(),
                sku: raw.sku!,
                name: raw.variant_name ?? 'Default',
                priceMinor: Number(raw.variant_price_minor),
                inventoryQty: Number(raw.inventory_qty),
                weightGrams: Number(raw.weight_grams),
                attributes: {},
              }],
            },
            media: (raw.media_urls || '').split(/[\s|]+/).filter(Boolean).length > 0
              ? {
                  create: (raw.media_urls || '').split(/[\s|]+/).filter(Boolean).map((url, idx) => ({
                    id: newId(),
                    url,
                    position: idx,
                  })),
                }
              : undefined,
          },
        });
        await this.fees.chargeOnPublish(seller.id, created.id, categoryId);
        r.productId = created.id;
        r.slug = created.slug;
      } catch (e) {
        r.status = 'error';
        r.message = e instanceof Error ? e.message : 'Unknown error';
      }
    }

    const finalOk = report.filter((r) => r.status === 'ok').length;
    const finalErr = report.filter((r) => r.status === 'error').length;
    return { dryRun, total: report.length, okCount: finalOk, errorCount: finalErr, rows: report };
  }

  private validateRow(raw: Record<string, string>): string | null {
    for (const h of TEMPLATE_HEADERS) {
      if (h === 'media_urls') continue;
      if (h === 'description') continue; // allowed empty
      if (!raw[h] || raw[h]!.trim() === '') return `missing ${h}`;
    }
    if (!/^\d+$/.test(raw.base_price_minor!)) return 'base_price_minor must be integer';
    if (!/^\d+$/.test(raw.variant_price_minor!)) return 'variant_price_minor must be integer';
    if (!/^\d+$/.test(raw.inventory_qty!)) return 'inventory_qty must be integer';
    if (!/^\d+$/.test(raw.weight_grams!)) return 'weight_grams must be integer';
    return null;
  }

  private async uniqueSlug(title: string): Promise<string> {
    const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
    let slug = base;
    let n = 2;
    while (await this.prisma.product.findUnique({ where: { slug } })) {
      slug = `${base}-${n++}`;
    }
    return slug;
  }
}
