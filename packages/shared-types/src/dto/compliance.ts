export type ComplianceRequirementKind =
  | 'AGE_GATE'
  | 'ID_VERIFICATION'
  | 'LICENSE_DOC'
  | 'JURISDICTION_RESTRICTED'
  | 'DIGITAL_LICENSE';

export type ComplianceDocStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

export type AgeConsentMethod = 'SELF_DECLARATION' | 'ID_VERIFIED' | 'PAYMENT_GATEWAY';

export interface CategoryComplianceDto {
  id: string;
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  minBuyerAge: number | null;
  requiresSellerDoc: boolean;
  requirementKinds: ComplianceRequirementKind[];
  blockedCountries: string[];
  allowedCountries: string[];
  notes: string | null;
}

export interface UpsertCategoryComplianceRequest {
  minBuyerAge?: number | null;
  requiresSellerDoc?: boolean;
  requirementKinds?: ComplianceRequirementKind[];
  blockedCountries?: string[];
  allowedCountries?: string[];
  notes?: string | null;
}

export interface SellerComplianceDocDto {
  id: string;
  sellerId: string;
  sellerName?: string;
  categoryId: string | null;
  categorySlug: string | null;
  docType: string;
  fileObjectKey: string;
  fileSizeBytes: number;
  status: ComplianceDocStatus;
  expiresAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

export interface UploadComplianceDocRequest {
  categoryId?: string;
  docType: string;
  // base64 payload (small file; we keep MinIO uploads server-side)
  fileBase64: string;
  fileName: string;
}

export interface ReviewComplianceDocRequest {
  approve: boolean;
  rejectionReason?: string;
  expiresAt?: string | null;
}

export interface AgeConsentRequest {
  productId?: string;
  categoryId?: string;
  dob: string; // ISO date
  method?: AgeConsentMethod;
  sessionId?: string;
}

export interface AgeConsentResultDto {
  ok: boolean;
  declaredAge: number;
  cookieValue: string;
  expiresAt: string;
}

export interface ProductComplianceSummaryDto {
  requiresAgeCheck: boolean;
  minBuyerAge: number | null;
  blockedCountries: string[];
  allowedCountries: string[];
  requirementKinds: ComplianceRequirementKind[];
  isDigital: boolean;
  digitalType?: 'LICENSE_KEY' | 'FILE_DOWNLOAD' | null;
}
