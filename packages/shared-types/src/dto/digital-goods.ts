export type DigitalGoodType = 'LICENSE_KEY' | 'FILE_DOWNLOAD';
export type LicenseKeyStatus = 'AVAILABLE' | 'ASSIGNED' | 'REVOKED';

export interface DigitalProductDto {
  id: string;
  productId: string;
  type: DigitalGoodType;
  fileObjectKey: string | null;
  fileSizeBytes: number | null;
  downloadLimit: number;
  expiryDays: number;
  notesToBuyer: string | null;
  poolStats?: {
    available: number;
    assigned: number;
    revoked: number;
  };
}

export interface UpsertDigitalProductRequest {
  type: DigitalGoodType;
  downloadLimit?: number;
  expiryDays?: number;
  notesToBuyer?: string | null;
  // for FILE_DOWNLOAD only
  fileBase64?: string;
  fileName?: string;
}

export interface ImportLicenseKeysRequest {
  keys: string[];
}

export interface ImportLicenseKeysResultDto {
  inserted: number;
  skippedDuplicates: number;
  totalAvailable: number;
}

export interface DigitalDeliveryDto {
  id: string;
  orderItemId: string;
  productTitle: string;
  productSlug: string;
  type: DigitalGoodType;
  downloadCount: number;
  downloadLimit: number;
  expiresAt: string;
  deliveredAt: string;
  hasLicenseKey: boolean;
  fileSizeBytes: number | null;
  notesToBuyer: string | null;
}

export interface LicenseKeyRevealDto {
  code: string;
}

export interface DownloadUrlDto {
  url: string;
  expiresInSec: number;
  downloadsRemaining: number;
}
