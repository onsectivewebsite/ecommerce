import { OnsectiveClient } from '../client';

export type QnaAuthorRole = 'BUYER' | 'VERIFIED_OWNER' | 'SELLER' | 'ADMIN';
export type QnaStatus = 'VISIBLE' | 'HIDDEN_BY_ADMIN' | 'DELETED_BY_AUTHOR';

export interface PublicAnswer {
  id: string;
  body: string;
  authorRole: QnaAuthorRole;
  authorFirstName: string;
  helpfulCount: number;
  viewerVoted: boolean;
  createdAt: string;
}

export interface PublicQuestion {
  id: string;
  body: string;
  askerFirstName: string;
  answerCount: number;
  createdAt: string;
  answers: PublicAnswer[];
}

export interface PublicQnaPage {
  total: number;
  page: number;
  pageSize: number;
  items: PublicQuestion[];
}

export interface ModerationAnswer {
  id: string;
  body: string;
  authorRole: QnaAuthorRole;
  status: QnaStatus;
  hiddenReason: string | null;
  helpfulCount: number;
  authorFirstName: string;
  createdAt: string;
}

export interface ModerationQuestion {
  id: string;
  body: string;
  status: QnaStatus;
  hiddenReason: string | null;
  answerCount: number;
  askerFirstName: string;
  product: { id: string; slug: string; title: string };
  createdAt: string;
  answers: ModerationAnswer[];
}

export interface MyQna {
  questions: Array<{
    id: string;
    body: string;
    status: QnaStatus;
    answerCount: number;
    product: { id: string; slug: string; title: string };
    createdAt: string;
  }>;
  answers: Array<{
    id: string;
    body: string;
    status: QnaStatus;
    authorRole: QnaAuthorRole;
    helpfulCount: number;
    question: { id: string; body: string; product: { id: string; slug: string; title: string } };
    createdAt: string;
  }>;
}

export interface HelpfulResult {
  answerId: string;
  helpful: boolean;
  helpfulCount: number;
}

export class QnaApi {
  constructor(private readonly client: OnsectiveClient) {}

  forProduct(productId: string, page = 1, pageSize = 20) {
    return this.client.request<PublicQnaPage>(`/qna/product/${productId}`, {
      query: { page, pageSize },
    });
  }

  // ---- buyer ----
  ask(body: { productId: string; body: string }) {
    return this.client.request<{ id: string }>('/qna/questions', { method: 'POST', body });
  }
  answer(questionId: string, body: { body: string }) {
    return this.client.request<{ id: string }>(`/qna/questions/${questionId}/answers`, {
      method: 'POST',
      body,
    });
  }
  toggleHelpful(answerId: string) {
    return this.client.request<HelpfulResult>(`/qna/answers/${answerId}/helpful`, { method: 'POST' });
  }
  removeQuestion(questionId: string) {
    return this.client.request<{ id: string }>(`/qna/questions/${questionId}`, { method: 'DELETE' });
  }
  removeAnswer(answerId: string) {
    return this.client.request<{ id: string }>(`/qna/answers/${answerId}`, { method: 'DELETE' });
  }
  mine() {
    return this.client.request<MyQna>('/qna/mine');
  }

  // ---- seller ----
  listForSeller() {
    return this.client.request<ModerationQuestion[]>('/seller/qna');
  }
  sellerAnswer(questionId: string, body: { body: string }) {
    return this.client.request<{ id: string }>(`/seller/qna/questions/${questionId}/answers`, {
      method: 'POST',
      body,
    });
  }

  // ---- admin ----
  adminList(status?: string) {
    return this.client.request<ModerationQuestion[]>('/admin/qna', { query: { status } });
  }
  adminHideQuestion(id: string, body: { reason: string }) {
    return this.client.request<{ id: string }>(`/admin/qna/questions/${id}/hide`, { method: 'POST', body });
  }
  adminUnhideQuestion(id: string) {
    return this.client.request<{ id: string }>(`/admin/qna/questions/${id}/unhide`, { method: 'POST' });
  }
  adminHideAnswer(id: string, body: { reason: string }) {
    return this.client.request<{ id: string }>(`/admin/qna/answers/${id}/hide`, { method: 'POST', body });
  }
  adminUnhideAnswer(id: string) {
    return this.client.request<{ id: string }>(`/admin/qna/answers/${id}/unhide`, { method: 'POST' });
  }
}
