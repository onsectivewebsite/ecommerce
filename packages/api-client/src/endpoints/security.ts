import { OnsectiveClient } from '../client';

export interface LoginEventRow {
  id: string;
  outcome: 'SUCCESS' | 'FAILURE';
  country: string | null;
  newDevice: boolean;
  anomaly: string | null;
  occurredAt: string;
  uaFingerprint: string;
}

export class SecurityApi {
  constructor(private readonly client: OnsectiveClient) {}

  loginEvents() {
    return this.client.request<LoginEventRow[]>('/security/login-events');
  }
}
