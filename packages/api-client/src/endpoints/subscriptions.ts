import type {
  SellerSubscriptionDto,
  StartSubscriptionRequest,
  StartSubscriptionResponse,
  TierDefinitionDto,
} from '@onsective/shared-types';
import { OnsectiveClient } from '../client';

export class SubscriptionsApi {
  constructor(private readonly client: OnsectiveClient) {}

  tiers() {
    return this.client.request<TierDefinitionDto[]>('/subscription-tiers', { noAuth: true });
  }

  mine() {
    return this.client.request<SellerSubscriptionDto>('/seller/subscription');
  }

  start(body: StartSubscriptionRequest) {
    return this.client.request<StartSubscriptionResponse>('/seller/subscription/start', {
      method: 'POST',
      body,
    });
  }

  cancel() {
    return this.client.request<SellerSubscriptionDto>('/seller/subscription/cancel', { method: 'POST' });
  }
}
