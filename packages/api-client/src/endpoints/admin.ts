import type {
  AdminSettingDto,
  AuditEntryDto,
  ListingFeeChargeDto,
  ListingFeeRuleDto,
  OrderDto,
  SellerAdminDto,
  SellerStatus,
} from '@onsective/shared-types';
import { OnsectiveClient } from '../client';

export class AdminApi {
  constructor(private readonly client: OnsectiveClient) {}

  listSellers(status?: SellerStatus) {
    return this.client.request<SellerAdminDto[]>('/admin/sellers', { query: { status } });
  }

  approveSeller(id: string, commissionBps?: number) {
    return this.client.request<SellerAdminDto>(`/admin/sellers/${id}/approve`, {
      method: 'POST',
      body: commissionBps !== undefined ? { commissionBps } : undefined,
    });
  }

  rejectSeller(id: string, reason?: string) {
    return this.client.request<SellerAdminDto>(`/admin/sellers/${id}/reject`, {
      method: 'POST',
      body: reason ? { reason } : undefined,
    });
  }

  listOrders() {
    return this.client.request<OrderDto[]>('/admin/orders');
  }

  listSettings() {
    return this.client.request<AdminSettingDto[]>('/admin/settings');
  }

  updateSetting(body: { key: string; value: string }) {
    return this.client.request<AdminSettingDto>('/admin/settings', { method: 'PATCH', body });
  }

  // Phase 3 — listing fees
  listListingFees(sellerId?: string) {
    return this.client.request<ListingFeeRuleDto[]>('/admin/listing-fees', { query: { sellerId } });
  }

  listListingFeeCharges(params: { sellerId?: string; productId?: string; limit?: number } = {}) {
    return this.client.request<ListingFeeChargeDto[]>('/admin/listing-fees/charges', { query: params });
  }

  createListingFee(body: Partial<ListingFeeRuleDto> & { amountMinor: number }) {
    return this.client.request<ListingFeeRuleDto>('/admin/listing-fees', { method: 'POST', body });
  }

  updateListingFee(id: string, body: Partial<ListingFeeRuleDto>) {
    return this.client.request<ListingFeeRuleDto>(`/admin/listing-fees/${id}`, { method: 'PATCH', body });
  }

  deleteListingFee(id: string) {
    return this.client.request<{ ok: true }>(`/admin/listing-fees/${id}`, { method: 'DELETE' });
  }

  // Phase 3 — audit log
  auditLog(params: { actorUserId?: string; entityType?: string; entityId?: string } = {}) {
    return this.client.request<AuditEntryDto[]>('/admin/audit-log', { query: params });
  }

  // Phase 31 — 2FA admin reset for locked-out users
  resetUserTwoFactor(userId: string) {
    return this.client.request<{ ok: true }>(`/admin/users/${userId}/2fa/reset`, {
      method: 'POST',
    });
  }

  // Phase 33 — Passkey admin reset
  resetUserWebauthn(userId: string) {
    return this.client.request<{ ok: true }>(`/admin/users/${userId}/webauthn/reset`, {
      method: 'POST',
    });
  }

  // Phase 34 — account recovery oversight
  recoveryRequests() {
    return this.client.request<import('./auth').RecoveryRequestRow[]>(
      '/admin/security/recovery-requests',
    );
  }
  cancelRecoveryRequest(id: string) {
    return this.client.request<{ ok: true }>(
      `/admin/security/recovery-requests/${id}/cancel`,
      { method: 'POST' },
    );
  }
}
