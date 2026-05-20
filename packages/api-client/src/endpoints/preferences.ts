import { OnsectiveClient } from '../client';

export type NotificationPrefs = Record<string, { email?: boolean; push?: boolean }>;

export class PreferencesApi {
  constructor(private readonly client: OnsectiveClient) {}

  notifications() {
    return this.client.request<NotificationPrefs>('/preferences/notifications');
  }

  setNotification(body: { category: string; channel: 'email' | 'push'; enabled: boolean }) {
    return this.client.request<NotificationPrefs>('/preferences/notifications', { method: 'POST', body });
  }
}
