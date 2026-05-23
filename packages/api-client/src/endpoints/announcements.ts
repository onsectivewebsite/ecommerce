import { OnsectiveClient } from '../client';

export type AnnouncementLevel = 'INFO' | 'SUCCESS' | 'WARNING';

export interface AnnouncementRow {
  id: string;
  title: string;
  message: string;
  level: AnnouncementLevel;
  linkUrl: string | null;
  linkLabel: string | null;
  startsAt: string;
  endsAt: string | null;
}

export interface AdminAnnouncementRow extends AnnouncementRow {
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAnnouncementBody {
  title: string;
  message: string;
  level?: AnnouncementLevel;
  linkUrl?: string;
  linkLabel?: string;
  startsAt: string;
  endsAt?: string;
  isActive?: boolean;
}

export type UpdateAnnouncementBody = Partial<CreateAnnouncementBody>;

export class AnnouncementsApi {
  constructor(private readonly client: OnsectiveClient) {}

  current() {
    return this.client.request<AnnouncementRow | null>('/announcements/current');
  }
  myDismissals() {
    return this.client.request<string[]>('/announcements/my-dismissals');
  }
  dismiss(id: string) {
    return this.client.request<{ ok: true }>(`/announcements/${id}/dismiss`, { method: 'POST' });
  }

  adminList() {
    return this.client.request<AdminAnnouncementRow[]>('/admin/announcements');
  }
  adminCreate(body: CreateAnnouncementBody) {
    return this.client.request<AdminAnnouncementRow>('/admin/announcements', { method: 'POST', body });
  }
  adminUpdate(id: string, body: UpdateAnnouncementBody) {
    return this.client.request<AdminAnnouncementRow>(`/admin/announcements/${id}`, { method: 'PATCH', body });
  }
  adminRemove(id: string) {
    return this.client.request<{ ok: true }>(`/admin/announcements/${id}`, { method: 'DELETE' });
  }
}
