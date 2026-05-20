import type {
  DigitalDeliveryDto,
  DigitalProductDto,
  DownloadUrlDto,
  ImportLicenseKeysRequest,
  ImportLicenseKeysResultDto,
  LicenseKeyRevealDto,
  UpsertDigitalProductRequest,
} from '@onsective/shared-types';
import { OnsectiveClient } from '../client';

export class DigitalApi {
  constructor(private readonly client: OnsectiveClient) {}

  // ---- Seller ----

  getForProduct(productId: string) {
    return this.client.request<DigitalProductDto | null>(
      `/seller/digital/${encodeURIComponent(productId)}`,
    );
  }

  upsert(productId: string, body: UpsertDigitalProductRequest) {
    return this.client.request<DigitalProductDto>(
      `/seller/digital/${encodeURIComponent(productId)}`,
      { method: 'PUT', body },
    );
  }

  importKeys(productId: string, body: ImportLicenseKeysRequest) {
    return this.client.request<ImportLicenseKeysResultDto>(
      `/seller/digital/${encodeURIComponent(productId)}/license-keys`,
      { method: 'POST', body },
    );
  }

  // ---- Buyer ----

  listMyDeliveries() {
    return this.client.request<DigitalDeliveryDto[]>('/downloads');
  }

  revealKey(deliveryId: string) {
    return this.client.request<LicenseKeyRevealDto>(
      `/downloads/${encodeURIComponent(deliveryId)}/key`,
    );
  }

  mintDownloadUrl(deliveryId: string) {
    return this.client.request<DownloadUrlDto>(
      `/downloads/${encodeURIComponent(deliveryId)}/url`,
      { method: 'POST' },
    );
  }
}
