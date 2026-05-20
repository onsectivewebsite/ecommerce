import { OnsectiveClient } from '../client';

export interface PushDeviceDto {
  id: string;
  expoPushToken: string;
  platform: 'IOS' | 'ANDROID' | 'WEB';
  status: 'ACTIVE' | 'INACTIVE' | 'REVOKED';
  deviceModel?: string | null;
  appVersion?: string | null;
  locale?: string | null;
  lastSeenAt: string;
}

export interface RegisterDeviceRequest {
  expoPushToken: string;
  platform: 'IOS' | 'ANDROID' | 'WEB';
  deviceModel?: string;
  appVersion?: string;
  locale?: string;
}

export class NotificationsApi {
  constructor(private readonly client: OnsectiveClient) {}

  registerDevice(body: RegisterDeviceRequest) {
    return this.client.request<PushDeviceDto>('/notifications/devices', {
      method: 'POST',
      body,
    });
  }

  myDevices() {
    return this.client.request<PushDeviceDto[]>('/notifications/devices');
  }

  unregister(id: string) {
    return this.client.request<{ ok: true }>(`/notifications/devices/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }
}
