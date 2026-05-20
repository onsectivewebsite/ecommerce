import type { SellerStatus } from '../enums';

export interface SellerAdminDto {
  id: string;
  storeName: string;
  displayName: string;
  status: SellerStatus;
  ownerEmail: string;
  ownerName: string;
  commissionBps: number | null;
  createdAt: string;
}

export interface AdminSettingDto {
  key: string;
  value: string;
  description?: string;
}
