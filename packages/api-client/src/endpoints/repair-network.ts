import { OnsectiveClient } from '../client';

export type RepairPartnerStatus = 'PENDING' | 'ACTIVE' | 'PAUSED' | 'REVOKED';

export type ServiceTicketStatus =
  | 'CREATED' | 'ASSIGNED' | 'INBOUND' | 'RECEIVED'
  | 'DIAGNOSING' | 'REPAIRING' | 'OUTBOUND'
  | 'COMPLETED' | 'CANCELLED';

export type ServiceTicketEventKind =
  | 'STATUS_CHANGED' | 'NOTE_ADDED' | 'ASSIGNED' | 'REASSIGNED'
  | 'CANCELLED' | 'COMPLETED';

export interface RepairPartnerRow {
  id: string;
  userId: string;
  displayName: string;
  status: RepairPartnerStatus;
  capabilityCategorySlugs: string[];
  dailyCapacity: number;
  turnaroundHours: number;
  serviceLine1: string | null;
  serviceCity: string | null;
  serviceRegion: string | null;
  servicePostal: string | null;
  serviceCountry: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { tickets: number };
}

export interface ServiceTicketEventRow {
  id: string;
  ticketId: string;
  kind: ServiceTicketEventKind;
  actorUserId: string | null;
  note: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ServiceTicketRow {
  id: string;
  warrantyClaimId: string;
  partnerId: string | null;
  status: ServiceTicketStatus;
  buyerNote: string | null;
  partnerNote: string | null;
  estimatedPartsCostMinor: number | null;
  currency: string | null;
  inboundCarrier: string | null;
  inboundTracking: string | null;
  outboundCarrier: string | null;
  outboundTracking: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  createdAt: string;
  updatedAt: string;
  partner?: { id: string; displayName: string; turnaroundHours?: number };
  warrantyClaim?: { id?: string; symptom: string; orderItem?: { productTitleSnapshot: string } };
  events?: ServiceTicketEventRow[];
}

export interface CreatePartnerPayload {
  userId: string;
  displayName: string;
  capabilityCategorySlugs?: string[];
  dailyCapacity?: number;
  turnaroundHours?: number;
  serviceLine1?: string;
  serviceCity?: string;
  serviceRegion?: string;
  servicePostal?: string;
  serviceCountry?: string;
  notes?: string;
}

export interface UpdatePartnerPayload {
  displayName?: string;
  status?: RepairPartnerStatus;
  capabilityCategorySlugs?: string[];
  dailyCapacity?: number;
  turnaroundHours?: number;
  notes?: string;
}

export interface UpdateTicketPayload {
  status?: ServiceTicketStatus;
  partnerNote?: string;
  estimatedPartsCostMinor?: number;
  currency?: string;
  inboundCarrier?: string;
  inboundTracking?: string;
  outboundCarrier?: string;
  outboundTracking?: string;
}

export class RepairNetworkApi {
  constructor(private readonly client: OnsectiveClient) {}

  // admin
  adminListPartners() {
    return this.client.request<RepairPartnerRow[]>('/admin/repair-network/partners');
  }
  adminCreatePartner(body: CreatePartnerPayload) {
    return this.client.request<RepairPartnerRow>('/admin/repair-network/partners', { method: 'POST', body });
  }
  adminUpdatePartner(id: string, body: UpdatePartnerPayload) {
    return this.client.request<RepairPartnerRow>(`/admin/repair-network/partners/${id}`, { method: 'PATCH', body });
  }
  adminListTickets(limit?: number) {
    return this.client.request<ServiceTicketRow[]>('/admin/repair-network/tickets', { query: { limit } });
  }
  adminUnassignedTickets() {
    return this.client.request<ServiceTicketRow[]>('/admin/repair-network/tickets/unassigned');
  }
  adminAssignTicket(id: string, partnerId: string) {
    return this.client.request<ServiceTicketRow>(`/admin/repair-network/tickets/${id}/assign`, {
      method: 'POST',
      body: { partnerId },
    });
  }
  adminUpdateTicket(id: string, body: UpdateTicketPayload) {
    return this.client.request<ServiceTicketRow>(`/admin/repair-network/tickets/${id}`, { method: 'PATCH', body });
  }
  adminCancelTicket(id: string, reason: string) {
    return this.client.request<ServiceTicketRow>(`/admin/repair-network/tickets/${id}/cancel`, {
      method: 'POST',
      body: { reason },
    });
  }

  // partner
  myQueue() {
    return this.client.request<ServiceTicketRow[]>('/partner/repair/tickets');
  }
  partnerUpdate(id: string, body: UpdateTicketPayload) {
    return this.client.request<ServiceTicketRow>(`/partner/repair/tickets/${id}/update`, { method: 'POST', body });
  }

  // buyer
  ticketForClaim(claimId: string) {
    return this.client.request<ServiceTicketRow | null>(`/warranty/claims/${claimId}/repair-ticket`);
  }
}
