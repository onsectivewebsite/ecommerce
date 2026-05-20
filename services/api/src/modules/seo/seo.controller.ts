import { Controller, Get, Header, Param, ParseIntPipe, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { SeoService, type SlugEntry } from './seo.service';

const XML_CACHE = 'public, max-age=3600';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function urlSet(entries: { loc: string; lastmod?: Date | null }[]): string {
  const lines = entries.map((e) => {
    const lastmod = e.lastmod ? `<lastmod>${e.lastmod.toISOString()}</lastmod>` : '';
    return `  <url><loc>${escapeXml(e.loc)}</loc>${lastmod}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${lines.join('\n')}
</urlset>`;
}

function sitemapIndex(entries: { loc: string; lastmod?: Date | null }[]): string {
  const lines = entries.map((e) => {
    const lastmod = e.lastmod ? `<lastmod>${e.lastmod.toISOString()}</lastmod>` : '';
    return `  <sitemap><loc>${escapeXml(e.loc)}</loc>${lastmod}</sitemap>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${lines.join('\n')}
</sitemapindex>`;
}

@ApiTags('seo')
@Controller('seo')
export class SeoController {
  constructor(
    private readonly svc: SeoService,
    private readonly cfg: ConfigService,
  ) {}

  private apiBase(): string {
    const base = this.cfg.get<string>('API_PUBLIC_URL');
    if (base) return base.replace(/\/+$/, '');
    const host = this.cfg.get<string>('HOST') ?? 'http://localhost:4000';
    return host.replace(/\/+$/, '');
  }

  private buyerBase(): string {
    const base = this.cfg.get<string>('BUYER_WEB_URL') ?? 'http://localhost:3000';
    return base.replace(/\/+$/, '');
  }

  @Get('sitemap-index.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', XML_CACHE)
  async index(@Res({ passthrough: true }) _res: Response): Promise<string> {
    const api = this.apiBase();
    const [chunks, productsMod, brandsMod, categoriesMod, outletMod] = await Promise.all([
      this.svc.productChunkCount(),
      this.svc.productsLastModified(),
      this.svc.brandsLastModified(),
      this.svc.categoriesLastModified(),
      this.svc.outletLastModified(),
    ]);
    const entries: { loc: string; lastmod?: Date | null }[] = [];
    for (let i = 0; i < chunks; i++) {
      entries.push({ loc: `${api}/seo/sitemap-products-${i + 1}.xml`, lastmod: productsMod });
    }
    entries.push({ loc: `${api}/seo/sitemap-brands.xml`, lastmod: brandsMod });
    entries.push({ loc: `${api}/seo/sitemap-categories.xml`, lastmod: categoriesMod });
    entries.push({ loc: `${api}/seo/sitemap-outlet.xml`, lastmod: outletMod });
    return sitemapIndex(entries);
  }

  @Get('sitemap-products-:n.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', XML_CACHE)
  async productsChunk(@Param('n', ParseIntPipe) n: number): Promise<string> {
    const idx = Math.max(0, n - 1);
    const rows = await this.svc.productSlugChunk(idx);
    return urlSet(this.toProductEntries(rows));
  }

  @Get('sitemap-brands.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', XML_CACHE)
  async brands(): Promise<string> {
    const rows = await this.svc.brandSlugs();
    return urlSet(rows.map((r) => ({
      loc: `${this.buyerBase()}/brand/${encodeURIComponent(r.slug)}`,
      lastmod: r.updatedAt,
    })));
  }

  @Get('sitemap-categories.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', XML_CACHE)
  async categories(): Promise<string> {
    const rows = await this.svc.categorySlugs();
    return urlSet(rows.map((r) => ({
      loc: `${this.buyerBase()}/c/${encodeURIComponent(r.slug)}`,
      lastmod: r.updatedAt,
    })));
  }

  @Get('sitemap-outlet.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', XML_CACHE)
  async outlet(): Promise<string> {
    const rows = await this.svc.outletProductSlugs();
    return urlSet(this.toProductEntries(rows));
  }

  private toProductEntries(rows: SlugEntry[]) {
    const base = this.buyerBase();
    return rows.map((r) => ({
      // Buyer-web routes products at /p/<slug> and categories at /c/<slug>.
      loc: `${base}/p/${encodeURIComponent(r.slug)}`,
      lastmod: r.updatedAt,
    }));
  }
}
