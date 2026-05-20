import type { CurrencyCode } from '../money';

export interface CartItemDto {
  id: string;
  variantId: string;
  productSlug: string;
  productTitle: string;
  variantName: string;
  unitPriceMinor: number;
  qty: number;
  lineSubtotalMinor: number;
  imageUrl?: string | null;
}

export interface CartDto {
  id: string;
  currency: CurrencyCode;
  items: CartItemDto[];
  subtotalMinor: number;
  itemCount: number;
}

export interface AddCartItemRequest {
  variantId: string;
  qty: number;
}

export interface UpdateCartItemRequest {
  qty: number;
}
