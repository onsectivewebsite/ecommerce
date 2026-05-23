import { OnsectiveClient } from '../client';

export interface SavedSearchRow {
  id: string;
  q: string;
  name: string | null;
  hitCount: number;
  lastCheckedAt: string;
  createdAt: string;
}

export class SavedSearchesApi {
  constructor(private readonly client: OnsectiveClient) {}

  list() {
    return this.client.request<SavedSearchRow[]>('/saved-searches');
  }
  create(body: { q: string; name?: string }) {
    return this.client.request<SavedSearchRow>('/saved-searches', { method: 'POST', body });
  }
  remove(id: string) {
    return this.client.request<{ ok: true }>(`/saved-searches/${id}`, { method: 'DELETE' });
  }
}
