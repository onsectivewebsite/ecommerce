import { OnsectiveClient } from '../client';

export interface FxRateRow {
  base: string;
  quote: string;
  rate: number;
  fetchedAt: string;
}

export interface FxConvertResult {
  amountMinor: number;
  rate: number;
  source: string;
  staleHours: number;
}

export class FxApi {
  constructor(private readonly client: OnsectiveClient) {}

  rates() {
    return this.client.request<FxRateRow[]>('/fx/rates', { noAuth: true });
  }

  convert(amountMinor: number, from: string, to: string) {
    return this.client.request<FxConvertResult>('/fx/convert', {
      query: { amountMinor, from, to },
      noAuth: true,
    });
  }

  refresh() {
    return this.client.request<{ ok: boolean; updated: number; reason?: string }>('/fx/refresh');
  }
}
