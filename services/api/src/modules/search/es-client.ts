import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface EsBulkOp {
  index: { _id: string };
}

/**
 * Minimal Elasticsearch / OpenSearch client. We avoid `@elastic/elasticsearch`
 * because its peer-dep churn drags in unused transports and TypeScript surface;
 * the cluster only needs `_search`, `_doc/<id>`, `_bulk`, and `indices.create`.
 *
 * isReady() returns false when ELASTICSEARCH_URL is unset, which lets the rest
 * of the codebase fall back to the Postgres path without throwing.
 */
@Injectable()
export class EsClient {
  private readonly logger = new Logger(EsClient.name);
  readonly index: string;
  private readonly base: string | null;
  private readonly auth: string | null;

  constructor(cfg: ConfigService) {
    this.base = (cfg.get<string>('ELASTICSEARCH_URL') ?? '').replace(/\/$/, '') || null;
    this.index = cfg.get<string>('ELASTICSEARCH_INDEX') ?? 'onsective-products';
    const user = cfg.get<string>('ELASTICSEARCH_USERNAME');
    const pass = cfg.get<string>('ELASTICSEARCH_PASSWORD');
    this.auth = user && pass ? `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` : null;
  }

  isReady(): boolean { return !!this.base; }

  async ensureIndex(): Promise<void> {
    if (!this.base) return;
    const head = await this.req('HEAD', `/${this.index}`);
    if (head.ok || head.status === 200) return;
    // Mapping kept small: title is the only "high boost" field; description analyzed but
    // weighted lower at query-time. Per-locale analyzers can be added by extending `analysis`.
    const body = {
      mappings: {
        properties: {
          title:       { type: 'text', analyzer: 'standard' },
          description: { type: 'text', analyzer: 'standard' },
          attributes:  { type: 'text' },
          sellerName:  { type: 'text', analyzer: 'standard' },
          categorySlug:{ type: 'keyword' },
          status:      { type: 'keyword' },
          sellerId:    { type: 'keyword' },
          currency:    { type: 'keyword' },
          basePriceMinor: { type: 'integer' },
          isDigital:   { type: 'boolean' },
          ratingAvg:   { type: 'float' },
          ratingCount: { type: 'integer' },
          createdAt:   { type: 'date' },
          updatedAt:   { type: 'date' },
        },
      },
      settings: { number_of_shards: 1, number_of_replicas: 1 },
    };
    const res = await this.req('PUT', `/${this.index}`, body);
    if (!res.ok && res.status !== 400) {
      // 400 == "index already exists" race; safe to ignore.
      throw new Error(`ES index create failed: ${res.status}`);
    }
  }

  async upsertDoc(id: string, doc: Record<string, unknown>): Promise<void> {
    if (!this.base) return;
    const res = await this.req('PUT', `/${this.index}/_doc/${encodeURIComponent(id)}`, doc);
    if (!res.ok) throw new Error(`ES upsert failed: ${res.status}`);
  }

  async deleteDoc(id: string): Promise<void> {
    if (!this.base) return;
    await this.req('DELETE', `/${this.index}/_doc/${encodeURIComponent(id)}`);
  }

  async bulkUpsert(docs: Array<{ id: string; doc: Record<string, unknown> }>): Promise<{ ok: number; errored: number }> {
    if (!this.base || docs.length === 0) return { ok: 0, errored: 0 };
    const lines: string[] = [];
    for (const d of docs) {
      const op: EsBulkOp = { index: { _id: d.id } };
      lines.push(JSON.stringify(op));
      lines.push(JSON.stringify(d.doc));
    }
    const body = lines.join('\n') + '\n';
    const url = `${this.base}/${this.index}/_bulk`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-ndjson', ...(this.auth ? { Authorization: this.auth } : {}) },
      body,
    });
    if (!res.ok) {
      this.logger.warn(`ES bulk failed: ${res.status}`);
      return { ok: 0, errored: docs.length };
    }
    const parsed = (await res.json()) as { items?: Array<{ index?: { status?: number; error?: unknown } }> };
    let ok = 0, errored = 0;
    for (const item of parsed.items ?? []) {
      const status = item.index?.status ?? 0;
      if (status >= 200 && status < 300) ok++;
      else errored++;
    }
    return { ok, errored };
  }

  async search(body: Record<string, unknown>): Promise<{ hits: Array<{ _id: string; _score: number; _source: any }>; total: number }> {
    if (!this.base) return { hits: [], total: 0 };
    const res = await this.req('POST', `/${this.index}/_search`, body);
    if (!res.ok) {
      this.logger.warn(`ES search failed: ${res.status}`);
      return { hits: [], total: 0 };
    }
    const json = (await res.json()) as any;
    const total = typeof json?.hits?.total === 'object' ? json.hits.total.value : (json?.hits?.total ?? 0);
    return { hits: json?.hits?.hits ?? [], total };
  }

  private async req(method: 'GET'|'POST'|'PUT'|'DELETE'|'HEAD', path: string, body?: unknown) {
    const url = `${this.base}${path}`;
    const headers: Record<string, string> = body ? { 'Content-Type': 'application/json' } : {};
    if (this.auth) headers.Authorization = this.auth;
    return fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  }
}
