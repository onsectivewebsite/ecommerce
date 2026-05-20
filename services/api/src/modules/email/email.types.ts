/**
 * Stable, provider-agnostic envelope. Concrete providers (Resend, SES, SMTP)
 * implement the EmailProvider interface against this shape.
 */
export interface EmailMessage {
  to: string;
  toName?: string;
  subject: string;
  /** Plain-text body; required. */
  text: string;
  /** Optional HTML body; providers fall back to text if absent. */
  html?: string;
  /** Category tag for analytics + per-category opt-out lookup. */
  category: string;
  /** Replaces template variables in subject/text/html if provided. */
  vars?: Record<string, string | number>;
}

export interface EmailDeliveryResult {
  providerMessageId: string | null;
  status: 'sent' | 'queued' | 'failed';
  error?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(msg: EmailMessage): Promise<EmailDeliveryResult>;
}
