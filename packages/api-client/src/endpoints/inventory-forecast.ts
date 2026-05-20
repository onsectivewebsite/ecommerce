import { OnsectiveClient } from '../client';

export interface ForecastAlertRow {
  id: string;
  variantId: string;
  severity: 'WARNING' | 'CRITICAL';
  velocityPerDay: number;
  daysUntilEmpty: number;
  acknowledgedAt: string | null;
  createdAt: string;
  variant: {
    id: string;
    name: string;
    sku: string;
    inventoryQty: number;
    product: { title: string; slug: string };
  };
}

export class InventoryForecastApi {
  constructor(private readonly client: OnsectiveClient) {}

  list(includeAcknowledged = false) {
    return this.client.request<ForecastAlertRow[]>('/seller/inventory/alerts', {
      query: { includeAcknowledged: includeAcknowledged ? '1' : undefined },
    });
  }

  acknowledge(id: string) {
    return this.client.request<ForecastAlertRow>(`/seller/inventory/alerts/${id}/acknowledge`, { method: 'POST' });
  }
}
