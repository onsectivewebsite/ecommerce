import { OnsectiveClient } from '../client';

export interface UserPreferencesPayload {
  locale: string;
  currency: string;
}

export interface UserPreferenceOptions {
  locales: readonly string[];
  currencies: readonly string[];
}

export class UsersApi {
  constructor(private readonly client: OnsectiveClient) {}

  getPreferences() {
    return this.client.request<UserPreferencesPayload>('/users/me/preferences');
  }

  updatePreferences(patch: Partial<UserPreferencesPayload>) {
    return this.client.request<UserPreferencesPayload>('/users/me/preferences', {
      method: 'PATCH',
      body: patch,
    });
  }

  preferenceOptions() {
    return this.client.request<UserPreferenceOptions>('/users/me/preferences/options', {
      noAuth: true,
    });
  }
}
