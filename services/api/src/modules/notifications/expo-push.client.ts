import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ExpoPushMessage {
  to: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  badge?: number;
  channelId?: string;
  categoryId?: string;
  priority?: 'default' | 'normal' | 'high';
}

export interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string; expoPushToken?: string };
}

/**
 * Tiny HTTP client for the Expo Push API.
 *
 *  - Default endpoint is https://exp.host/--/api/v2/push/send (public Expo service).
 *  - When EXPO_PUSH_URL is set we POST to the self-hosted FCM/APNs proxy instead;
 *    the proxy speaks the same JSON shape so the rest of the codebase is unchanged.
 *  - The API caps each batch at 100 messages — we shard if the caller passes more.
 */
@Injectable()
export class ExpoPushClient {
  private readonly logger = new Logger(ExpoPushClient.name);
  private readonly url: string;
  private readonly accessToken: string | null;

  constructor(cfg: ConfigService) {
    this.url = cfg.get<string>('EXPO_PUSH_URL') ?? 'https://exp.host/--/api/v2/push/send';
    this.accessToken = cfg.get<string>('EXPO_ACCESS_TOKEN') ?? null;
  }

  async send(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
    if (messages.length === 0) return [];
    const tickets: ExpoPushTicket[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100);
      try {
        const res = await fetch(this.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'Accept-Encoding': 'gzip, deflate',
            ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
          },
          body: JSON.stringify(batch),
        });
        if (!res.ok) {
          this.logger.warn(`Push batch failed: ${res.status}`);
          for (let j = 0; j < batch.length; j++) {
            tickets.push({ status: 'error', message: `HTTP ${res.status}` });
          }
          continue;
        }
        const body = (await res.json()) as { data?: ExpoPushTicket[] };
        for (let j = 0; j < batch.length; j++) {
          const t = body.data?.[j];
          tickets.push(
            t ?? { status: 'error', message: 'No ticket returned', details: { expoPushToken: batch[j].to } },
          );
        }
      } catch (e) {
        const msg = (e as Error).message;
        this.logger.warn(`Push send threw: ${msg}`);
        for (let j = 0; j < batch.length; j++) {
          tickets.push({ status: 'error', message: msg, details: { expoPushToken: batch[j].to } });
        }
      }
    }
    return tickets;
  }
}
