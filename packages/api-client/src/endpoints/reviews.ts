import { OnsectiveClient } from '../client';

export interface ReviewRow {
  id: string;
  productId: string;
  orderItemId: string;
  rating: number;
  title: string | null;
  body: string;
  status: string;
  sellerReply: string | null;
  sellerRepliedAt: string | null;
  createdAt: string;
}

export interface PublicReviewsPage {
  total: number;
  page: number;
  pageSize: number;
  ratingAvg: number;
  ratingCount: number;
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
  items: Array<{
    id: string;
    rating: number;
    title: string | null;
    body: string;
    sellerReply: string | null;
    sellerRepliedAt: string | null;
    buyerFirstName: string;
    createdAt: string;
  }>;
}

export class ReviewsApi {
  constructor(private readonly client: OnsectiveClient) {}

  forProduct(productId: string, page = 1, pageSize = 20) {
    return this.client.request<PublicReviewsPage>(`/reviews/product/${productId}`, {
      query: { page, pageSize },
    });
  }

  // ---- buyer ----
  create(body: { orderItemId: string; rating: number; title?: string; body: string }) {
    return this.client.request<ReviewRow>('/reviews', { method: 'POST', body });
  }
  mine() {
    return this.client.request<ReviewRow[]>('/reviews/mine');
  }
  remove(reviewId: string) {
    return this.client.request<ReviewRow>(`/reviews/${reviewId}`, { method: 'DELETE' });
  }

  // ---- seller ----
  listForSeller() {
    return this.client.request<ReviewRow[]>('/seller/reviews');
  }
  reply(reviewId: string, body: { reply: string }) {
    return this.client.request<ReviewRow>(`/seller/reviews/${reviewId}/reply`, { method: 'POST', body });
  }

  // ---- admin ----
  adminList(status?: string) {
    return this.client.request<ReviewRow[]>('/admin/reviews', { query: { status } });
  }
  adminHide(reviewId: string, body: { reason: string }) {
    return this.client.request<ReviewRow>(`/admin/reviews/${reviewId}/hide`, { method: 'POST', body });
  }
  adminUnhide(reviewId: string) {
    return this.client.request<ReviewRow>(`/admin/reviews/${reviewId}/unhide`, { method: 'POST' });
  }
}
