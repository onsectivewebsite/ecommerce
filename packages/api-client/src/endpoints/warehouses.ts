import { OnsectiveClient } from '../client';

export interface WarehouseRow {
  id: string;
  code: string;
  displayName: string;
  status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
  line1: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  priority: number;
  createdAt: string;
  zones: Array<{ id: string; country: string; regions: string[] }>;
  _count?: { stocks: number };
}

export interface PublicWarehouseRow {
  id: string;
  code: string;
  displayName: string;
  country: string;
  region: string;
  city: string;
  zones: Array<{ country: string; regions: string[] }>;
}

export interface CreateWarehousePayload {
  code: string;
  displayName: string;
  line1: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  priority?: number;
  zones?: Array<{ country: string; regions?: string[] }>;
}

export class WarehousesApi {
  constructor(private readonly client: OnsectiveClient) {}

  publicList() {
    return this.client.request<PublicWarehouseRow[]>('/warehouses');
  }

  adminList() {
    return this.client.request<WarehouseRow[]>('/admin/warehouses');
  }
  adminCreate(body: CreateWarehousePayload) {
    return this.client.request<WarehouseRow>('/admin/warehouses', { method: 'POST', body });
  }
  adminUpdate(id: string, body: Partial<Pick<WarehouseRow, 'displayName' | 'status' | 'priority'>>) {
    return this.client.request<WarehouseRow>(`/admin/warehouses/${id}`, { method: 'PATCH', body });
  }
  addZone(id: string, body: { country: string; regions?: string[] }) {
    return this.client.request<{ id: string }>(`/admin/warehouses/${id}/zones`, { method: 'POST', body });
  }
  removeZone(warehouseId: string, zoneId: string) {
    return this.client.request<{ ok: boolean }>(
      `/admin/warehouses/${warehouseId}/zones/${zoneId}`, { method: 'DELETE' },
    );
  }
}
