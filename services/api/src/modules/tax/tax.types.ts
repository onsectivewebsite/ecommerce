export type TaxKind = 'GST' | 'HST' | 'VAT' | 'SALES' | 'CONSUMPTION' | 'NONE';

export interface TaxLine {
  kind: TaxKind;
  name: string;
  jurisdictionCode: string;
  ratePctMicro: number;
  amountMinor: number;
  baseMinor: number;
}

export interface TaxItem {
  productId: string;
  categorySlug: string;
  lineSubtotalMinor: number;
  qty: number;
}

export interface TaxContext {
  country: string;     // ISO-2 (e.g. "IN")
  region?: string;     // state/province (e.g. "KA")
  postalCode?: string;
  sellerCountry?: string;
  sellerRegion?: string;
  currency: string;
  /** Sum of all line subtotals plus any non-tax surcharges (e.g. shipping). */
  baseMinor: number;
  /** Per-item breakdown — used by jurisdiction-specific category rules (VAT reduced/zero, etc.). */
  items: TaxItem[];
}

export interface TaxRuleRow {
  id: string;
  name: string;
  kind: TaxKind;
  jurisdictionType: 'COUNTRY' | 'REGION' | 'POSTAL_PREFIX';
  jurisdictionCode: string;
  ratePctMicro: number;
  includedInPrice: boolean;
  categorySlug: string | null;
  priority: number;
  enabled: boolean;
}

export interface TaxStrategy {
  readonly kind: TaxKind;
  /**
   * Return zero or more `TaxLine`s for this jurisdiction. The strategy is responsible
   * for picking the right base (e.g. exclude shipping in some jurisdictions, split CGST+SGST
   * for India intra-state).
   */
  apply(ctx: TaxContext, rules: TaxRuleRow[]): TaxLine[];
}

export function ratePctToFraction(microRate: number): number {
  return microRate / 1_000_000 / 100;
}

export function applyRate(baseMinor: number, microRate: number): number {
  return Math.round(baseMinor * (microRate / 1_000_000 / 100));
}
