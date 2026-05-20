import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { EmailDeliveryResult, EmailMessage, EmailProvider } from './email.types';

/**
 * Generic SMTP provider (Hostinger, Gmail, any RFC-5321 host). Driven by
 * SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD. Port 465 implies
 * implicit TLS; any other port negotiates STARTTLS.
 */
@Injectable()
export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  private readonly logger = new Logger(SmtpEmailProvider.name);
  private readonly from: string;
  private readonly transporter: Transporter | null;

  constructor(cfg: ConfigService) {
    const host = cfg.get<string>('SMTP_HOST') ?? '';
    const port = Number(cfg.get('SMTP_PORT') ?? 465);
    const user = cfg.get<string>('SMTP_USER') ?? '';
    const pass = cfg.get<string>('SMTP_PASSWORD') ?? '';
    this.from = cfg.get<string>('EMAIL_FROM') ?? 'Onsective <noreply@onsective.com>';

    if (!host || !user || !pass) {
      this.transporter = null;
      this.logger.warn('SMTP_HOST/SMTP_USER/SMTP_PASSWORD missing — smtp provider will reject sends');
      return;
    }
    this.transporter = createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }

  async send(msg: EmailMessage): Promise<EmailDeliveryResult> {
    if (!this.transporter) {
      return { providerMessageId: null, status: 'failed', error: 'SMTP not configured' };
    }
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: msg.toName ? `${msg.toName} <${msg.to}>` : msg.to,
        subject: msg.subject,
        text: msg.text,
        ...(msg.html ? { html: msg.html } : {}),
        headers: { 'X-Email-Category': msg.category },
      });
      return { providerMessageId: info.messageId ?? null, status: 'sent' };
    } catch (e) {
      this.logger.warn(`smtp send failed: ${(e as Error).message}`);
      return { providerMessageId: null, status: 'failed', error: (e as Error).message };
    }
  }
}
