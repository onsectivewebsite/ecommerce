import { OnsectiveClient } from '../client';

export type BrandMode = 'INVENTORY_HOLDING' | 'AUTHORIZED_ONLY';

export interface BrandRow {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  contactEmail: string | null;
  categorySlugs: string[];
  mode: BrandMode;
  sellerId: string | null;
  heroMediaUrl: string | null;
  heroHeadline: string | null;
  heroSubcopy: string | null;
  story: string | null;
  accentColor: string | null;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { products: number; authorizations: number };
}

export interface BrandCollectionRow {
  id: string;
  brandId: string;
  slug: string;
  title: string;
  subtitle: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  products: Array<{
    id: string;
    collectionId: string;
    productId: string;
    position: number;
    product?: { id: string; slug: string; title: string; status: string; condition: string; sellerId: string };
  }>;
}

export interface BrandStorefrontProductCard {
  id: string;
  slug: string;
  title: string;
  currency: string;
  basePriceMinor: number;
  media: Array<{ id: string; url: string; alt: string | null; position: number }>;
  sellerName: string;
  categorySlug: string;
  status: string;
  condition: 'NEW_GENUINE' | 'REFURB_GRADE_A' | 'REFURB_GRADE_B' | 'REFURB_GRADE_C';
}

export interface BrandStorefront {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  mode: BrandMode;
  heroMediaUrl: string | null;
  heroHeadline: string | null;
  heroSubcopy: string | null;
  story: string | null;
  accentColor: string | null;
  sellerId: string | null;
  sellerName: string | null;
  collections: Array<{
    id: string;
    slug: string;
    title: string;
    subtitle: string | null;
    position: number;
    products: BrandStorefrontProductCard[];
  }>;
  liveProducts: BrandStorefrontProductCard[];
}

export interface UpdateStorefrontPayload {
  mode?: BrandMode;
  heroMediaUrl?: string;
  heroHeadline?: string;
  heroSubcopy?: string;
  story?: string;
  accentColor?: string;
  isPublished?: boolean;
}

export interface AttachSellerPayload {
  sellerId?: string;
  storeName?: string;
  displayName?: string;
}

export interface CreateCollectionPayload {
  slug: string;
  title: string;
  subtitle?: string;
  position?: number;
}

export interface PublicBrandRow {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  categorySlugs: string[];
}

export interface BrandAuthorizationRow {
  id: string;
  sellerId: string;
  brandId: string;
  categorySlug: string;
  startsAt: string;
  expiresAt: string;
  documentUrl: string | null;
  note: string | null;
  createdAt: string;
  brand?: { id: string; slug: string; name: string };
  seller?: { id: string; storeName: string; displayName: string };
}

export interface CreateBrandPayload {
  slug: string;
  name: string;
  logoUrl?: string;
  contactEmail?: string;
  categorySlugs?: string[];
}

export interface AuthorizeSellerPayload {
  sellerId: string;
  brandId: string;
  categorySlug: string;
  expiresAt: string;
  documentUrl?: string;
  note?: string;
}

export class BrandsApi {
  constructor(private readonly client: OnsectiveClient) {}

  publicList() {
    return this.client.request<PublicBrandRow[]>('/brands');
  }
  publicGet(slug: string) {
    return this.client.request<PublicBrandRow>(`/brands/${slug}`);
  }

  adminList() {
    return this.client.request<BrandRow[]>('/admin/brands');
  }
  adminCreate(body: CreateBrandPayload) {
    return this.client.request<BrandRow>('/admin/brands', { method: 'POST', body });
  }
  adminUpdate(id: string, body: Partial<Pick<BrandRow, 'name' | 'logoUrl' | 'contactEmail' | 'categorySlugs'>>) {
    return this.client.request<BrandRow>(`/admin/brands/${id}`, { method: 'PATCH', body });
  }
  adminListAuthorizations(brandId: string) {
    return this.client.request<BrandAuthorizationRow[]>(`/admin/brands/${brandId}/authorizations`);
  }
  authorize(body: AuthorizeSellerPayload) {
    return this.client.request<BrandAuthorizationRow>('/admin/brands/authorizations', {
      method: 'POST',
      body,
    });
  }
  revokeAuthorization(authId: string) {
    return this.client.request<{ ok: boolean }>(`/admin/brands/authorizations/${authId}`, {
      method: 'DELETE',
    });
  }

  myAuthorizations() {
    return this.client.request<BrandAuthorizationRow[]>('/seller/brand-authorizations');
  }

  // ---- Phase 17 storefront ----
  storefront(slug: string) {
    return this.client.request<BrandStorefront>(`/brands/${slug}/storefront`);
  }
  adminUpdateStorefront(id: string, body: UpdateStorefrontPayload) {
    return this.client.request<BrandRow>(`/admin/brands/${id}/storefront`, {
      method: 'PATCH',
      body,
    });
  }
  adminAttachSeller(id: string, body: AttachSellerPayload) {
    return this.client.request<BrandRow>(`/admin/brands/${id}/attach-seller`, {
      method: 'POST',
      body,
    });
  }
  adminListCollections(brandId: string) {
    return this.client.request<BrandCollectionRow[]>(`/admin/brands/${brandId}/collections`);
  }
  adminCreateCollection(brandId: string, body: CreateCollectionPayload) {
    return this.client.request<BrandCollectionRow>(`/admin/brands/${brandId}/collections`, {
      method: 'POST',
      body,
    });
  }
  adminSetCollectionProducts(collectionId: string, productIds: string[]) {
    return this.client.request<BrandCollectionRow>(
      `/admin/brands/collections/${collectionId}/products`,
      { method: 'PATCH', body: { productIds } },
    );
  }
  adminDeleteCollection(collectionId: string) {
    return this.client.request<{ ok: boolean }>(
      `/admin/brands/collections/${collectionId}`,
      { method: 'DELETE' },
    );
  }
}
