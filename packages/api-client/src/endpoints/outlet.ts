import { OnsectiveClient } from '../client';

export type OutletCondition =
  | 'OPEN_BOX'
  | 'REFURB_GRADE_A'
  | 'REFURB_GRADE_B'
  | 'REFURB_GRADE_C';

export type ReturnDisposition =
  | 'OUTLET_RELIST'
  | 'REFURB_REGRADE'
  | 'DISPOSE'
  | 'RETURN_TO_SELLER';

export interface OutletListing {
  productId: string;
  slug: string;
  title: string;
  condition: OutletCondition;
  sellerName: string;
  categorySlug: string;
  brand: { slug: string; name: string; logoUrl: string | null } | null;
  media: Array<{ id: string; url: string; alt: string | null; position: number }>;
  msrpMinor: number;
  outletPriceMinor: number;
  currency: string;
  discountBps: number;
  warrantyMonths: number;
}

export interface PendingReturnRow {
  id: string;
  orderId: string;
  sellerId: string;
  status: string;
  createdAt: string;
  items: Array<{
    id: string;
    qty: number;
    orderItem: {
      productTitleSnapshot: string;
      variant: { product: { id: string; slug: string; title: string; condition: string } };
    };
  }>;
  order: { id: string; sellerId: string };
}

export interface ReturnInspectionRow {
  id: string;
  returnId: string;
  warehouseId: string;
  technicianUserId: string;
  disposition: ReturnDisposition;
  conditionNotes: string | null;
  photoUrls: string[];
  outletDiscountBps: number | null;
  createdRefurbUnitId: string | null;
  disposeReason: string | null;
  createdAt: string;
  updatedAt: string;
  return?: { id: string; orderId: string; sellerId: string };
}

export interface InspectReturnPayload {
  returnId: string;
  warehouseId: string;
  disposition: ReturnDisposition;
  conditionNotes?: string;
  photoUrls?: string[];
  outletDiscountBps?: number;
  disposeReason?: string;
}

export class OutletApi {
  constructor(private readonly client: OnsectiveClient) {}

  listings(params?: { brand?: string; condition?: OutletCondition; earlyAccess?: boolean }) {
    const query = params
      ? {
          brand: params.brand,
          condition: params.condition,
          earlyAccess: params.earlyAccess ? 'true' : undefined,
        }
      : undefined;
    return this.client.request<OutletListing[]>('/outlet/listings', { query });
  }
}

export class ReturnsDispositionApi {
  constructor(private readonly client: OnsectiveClient) {}

  warehouseQueue(warehouseId?: string) {
    return this.client.request<PendingReturnRow[]>('/warehouse/returns/queue', {
      query: { warehouseId },
    });
  }
  inspect(body: InspectReturnPayload) {
    return this.client.request<ReturnInspectionRow>('/warehouse/returns/inspect', {
      method: 'POST',
      body,
    });
  }
  adminPending() {
    return this.client.request<PendingReturnRow[]>('/admin/returns/dispositions/pending');
  }
  adminRecent(limit?: number) {
    return this.client.request<ReturnInspectionRow[]>('/admin/returns/dispositions/recent', {
      query: { limit },
    });
  }
}
