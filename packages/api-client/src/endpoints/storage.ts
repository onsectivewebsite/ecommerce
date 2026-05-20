import { OnsectiveClient } from '../client';

export interface StorageBillingRow {
  id: string;
  sellerId: string;
  warehouseId: string;
  forDay: string;
  cubicCmStored: number;
  feeMinor: number;
  currency: string;
  billed: boolean;
  createdAt: string;
}

export interface StorageStatement {
  totalFeeMinor: number;
  currency: string;
  rows: StorageBillingRow[];
}

export class StorageApi {
  constructor(private readonly client: OnsectiveClient) {}

  statement(days = 30) {
    return this.client.request<StorageStatement>('/seller/storage/statement', { query: { days } });
  }
}
