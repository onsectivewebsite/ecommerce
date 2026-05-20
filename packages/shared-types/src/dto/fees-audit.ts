export interface ListingFeeRuleDto {
  id: string;
  sellerId: string | null;
  categoryId: string | null;
  amountMinor: number;
  currency: string;
  enabled: boolean;
  note?: string | null;
  createdAt: string;
}

export interface ListingFeeChargeDto {
  id: string;
  sellerId: string;
  productId: string;
  ruleId: string | null;
  amountMinor: number;
  currency: string;
  note?: string | null;
  chargedAt: string;
}

export interface AuditEntryDto {
  id: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}
