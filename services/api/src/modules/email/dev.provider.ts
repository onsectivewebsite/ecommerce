import { Injectable, Logger } from '@nestjs/common';
import type { EmailDeliveryResult, EmailMessage, EmailProvider } from './email.types';

/**
 * Logs every outbound email to stdout. Default in dev and CI so tests and
 * local devs can see what would have been sent without touching a real ESP.
 */
@Injectable()
export class DevEmailProvider implements EmailProvider {
  readonly name = 'dev';
  private readonly logger = new Logger(DevEmailProvider.name);

  async send(msg: EmailMessage): Promise<EmailDeliveryResult> {
    const id = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.logger.log(`[email:${msg.category}] → ${msg.to} | ${msg.subject}\n${msg.text.slice(0, 500)}`);
    return { providerMessageId: id, status: 'sent' };
  }
}
