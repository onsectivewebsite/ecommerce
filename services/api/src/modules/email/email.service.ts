import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { DevEmailProvider } from './dev.provider';
import { ResendEmailProvider } from './resend.provider';
import { SmtpEmailProvider } from './smtp.provider';
import { renderTemplate, templateKind } from './templates';
import type { EmailMessage, EmailProvider } from './email.types';
import { ConsentService } from '../privacy/consent.service';

export const EMAIL_PROVIDERS = Symbol('EMAIL_PROVIDERS');

interface CategoryPrefs { email?: boolean; push?: boolean }

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly active: EmailProvider;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_PROVIDERS) providers: EmailProvider[],
    private readonly consent: ConsentService,
    private readonly cfg: ConfigService,
  ) {
    const chosenName = process.env.EMAIL_PROVIDER ?? 'dev';
    this.active = providers.find((p) => p.name === chosenName) ?? providers[0]!;
    this.logger.log(`EmailService using provider: ${this.active.name}`);
  }

  private get publicUrl(): string {
    return this.cfg.get<string>('PUBLIC_WEB_URL') ?? 'http://localhost:3000';
  }

  /**
   * Render + send if (a) we have a template for the category, (b) the user
   * has an email on file, (c) for marketing kinds: the user has positive
   * marketing+email consent, (d) for any kind: the user has not opted out
   * via NotificationPreference for this category.
   *
   * Returns null when skipped, otherwise the provider's message id.
   */
  async sendToUser(
    userId: string,
    category: string,
    vars: Record<string, string | number> = {},
  ): Promise<string | null> {
    const tpl = renderTemplate(category, vars);
    if (!tpl) return null;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { notificationPreference: true },
    });
    if (!user?.email) return null;
    if (!this.allowsChannel(user.notificationPreference?.prefs, category, 'email')) return null;

    const kind = templateKind(category);
    let textBody = tpl.text;
    let htmlBody = tpl.html;

    if (kind === 'marketing') {
      const allowed = await this.consent.canSendMarketingEmail(userId);
      if (!allowed) {
        this.logger.log(`email.dropped.consent userId=${userId} category=${category}`);
        return null;
      }
      // Mint a one-shot unsubscribe token per send so revoking one campaign
      // doesn't affect others. Best-effort — if minting fails (DB hiccup) we
      // still let the email out without a footer rather than burying the
      // engagement signal.
      const footer = await this.consent
        .mintUnsubscribeToken(userId, 'marketingEmail')
        .then((token) => this.marketingFooter(token))
        .catch(() => '');
      textBody = `${tpl.text}\n\n${footer}`;
      if (tpl.html) htmlBody = `${tpl.html}<p style="color:#888;font-size:12px;margin-top:24px">${footer}</p>`;
    }

    return this.sendDirect(
      user.email,
      `${user.firstName} ${user.lastName}`.trim(),
      category,
      tpl.subject,
      textBody,
      htmlBody,
    );
  }

  private marketingFooter(token: string): string {
    const url = `${this.publicUrl}/unsubscribe?token=${encodeURIComponent(token)}`;
    return [
      '— — —',
      `You're receiving this because you opted in to marketing emails from Onsective.`,
      `Unsubscribe with one click: ${url}`,
      `Or manage all preferences at ${this.publicUrl}/account/preferences`,
    ].join('\n');
  }

  /** Send to an arbitrary address — bypasses both consent and per-category prefs.
   *  Use for transactional addresses (support@, etc.) and admin alerts. */
  async sendDirect(
    to: string,
    toName: string,
    category: string,
    subject: string,
    text: string,
    html?: string,
  ): Promise<string | null> {
    const msg: EmailMessage = { to, toName, subject, text, html, category };
    try {
      const result = await this.active.send(msg);
      return result.providerMessageId;
    } catch (e) {
      this.logger.warn(`email send failed [${category}] → ${to}: ${(e as Error).message}`);
      return null;
    }
  }

  // ---------- preference checks ----------

  allowsChannel(prefs: unknown, category: string, channel: 'email' | 'push'): boolean {
    if (!prefs || typeof prefs !== 'object') return true; // default-on
    const cat = (prefs as Record<string, CategoryPrefs>)[category];
    if (!cat) return true;
    if (channel === 'email') return cat.email !== false;
    return cat.push !== false;
  }

  // ---------- preference management ----------

  async getPreferences(userId: string) {
    const row = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    return (row?.prefs as Record<string, CategoryPrefs>) ?? {};
  }

  async setCategoryPref(userId: string, category: string, channel: 'email' | 'push', enabled: boolean) {
    const current = await this.getPreferences(userId);
    const cat = current[category] ?? {};
    if (channel === 'email') cat.email = enabled;
    else cat.push = enabled;
    current[category] = cat;
    await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { id: newId(), userId, prefs: current as unknown as object },
      update: { prefs: current as unknown as object },
    });
    return current;
  }
}

export const emailProvidersFactory = {
  provide: EMAIL_PROVIDERS,
  inject: [DevEmailProvider, ResendEmailProvider, SmtpEmailProvider],
  useFactory: (
    dev: DevEmailProvider,
    resend: ResendEmailProvider,
    smtp: SmtpEmailProvider,
  ): EmailProvider[] => [dev, resend, smtp],
};
