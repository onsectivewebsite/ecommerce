import { OnsectiveClient } from '../client';

export interface SavedPaymentMethod {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
  status: 'ACTIVE' | 'DETACHED';
  createdAt: string;
}

export class PaymentMethodsApi {
  constructor(private readonly client: OnsectiveClient) {}

  list() {
    return this.client.request<SavedPaymentMethod[]>('/payment-methods');
  }

  /** Returns the Stripe SetupIntent client_secret to confirm via Stripe.js. */
  createSetupIntent() {
    return this.client.request<{ clientSecret: string }>('/payment-methods/setup-intent', {
      method: 'POST',
    });
  }

  /** Called after the buyer confirms the SetupIntent client-side. */
  attach(body: { setupIntentId: string }) {
    return this.client.request<SavedPaymentMethod>('/payment-methods/attach', {
      method: 'POST',
      body,
    });
  }

  setDefault(id: string) {
    return this.client.request<SavedPaymentMethod>(`/payment-methods/${id}/default`, {
      method: 'POST',
    });
  }

  detach(id: string) {
    return this.client.request<SavedPaymentMethod>(`/payment-methods/${id}`, {
      method: 'DELETE',
    });
  }
}
