import type { PaginatedProducts } from '@onsective/shared-types';
import { OnsectiveClient } from '../client';

export interface SearchResult extends PaginatedProducts {
  source: 'elasticsearch' | 'postgres';
  suggestion?: string | null;
}

export class SearchApi {
  constructor(private readonly client: OnsectiveClient) {}

  query(opts: { query?: string; category?: string; page?: number; pageSize?: number } = {}) {
    return this.client.request<SearchResult>('/search', {
      query: opts as Record<string, string | number | undefined>,
      noAuth: true,
    });
  }
}
