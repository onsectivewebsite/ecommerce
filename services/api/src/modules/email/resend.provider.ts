import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmailDeliveryResult, EmailMessage, EmailProvider } from './email.types';

/**
 * Resend (resend.com) — chosen as the default real provider because it has
 * the simplest auth (Bearer token) and JSON API. To swap for SES / Postmark /
 * SendGrid, implement EmailProvider against their HTTP API and bind to
 * EMAIL_PROVIDER in EmailService.
 */
@Injectable()
export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  private readonly logger = new Logger(ResendEmailProvider.name);
  private readonly apiKey: string;
  private readonly from: string;

  constructor(cfg: ConfigService) {
    this.apiKey = cfg.get<string>('RESEND_API_KEY') ?? '';
    this.from = cfg.get<string>('EMAIL_FROM') ?? 'Onsective <noreply@onsective.com>';
  }

  async send(msg: EmailMessage): Promise<EmailDeliveryResult> {
    if (!this.apiKey) {
      return { providerMessageId: null, status: 'failed', error: 'RESEND_API_KEY not configured' };
    }
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: msg.toName ? [`${msg.toName} <${msg.to}>`] : [msg.to],
          subject: msg.subject,
          text: msg.text,
          ...(msg.html ? { html: msg.html } : {}),
          tags: [{ name: 'category', value: msg.category }],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { providerMessageId: null, status: 'failed', error: `resend ${res.status}: ${body.slice(0, 200)}` };
      }
      const data = (await res.json()) as { id?: string };
      return { providerMessageId: data.id ?? null, status: 'sent' };
    } catch (e) {
      this.logger.warn(`resend send failed: ${(e as Error).message}`);
      return { providerMessageId: null, status: 'failed', error: (e as Error).message };
    }
  }
}
