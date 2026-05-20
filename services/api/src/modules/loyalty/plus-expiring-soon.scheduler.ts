import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MembershipBillingEventKind,
  MembershipStatus,
  NotificationKind,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificationFeedService } from '../notification-feed/notification-feed.service';
import { newId } from '../../common/id';

const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

function fmtDate(d: Date) {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Phase 24: scans ACTIVE memberships where autoRenew is off and the term
 * ends within the next `LOYALTY_EXPIRING_SOON_DAYS` window (default 7).
 * Each membership gets at most one reminder per term — protected by a
 * synthesized providerEventId on `MembershipBillingEvent` so a re-run
 * doesn't double-send.
 *
 * Gated by `LOYALTY_EXPIRING_SCHEDULER_ENABLED=1` so it stays inert in
 * dev unless explicitly enabled.
 */
@Injectable()
export class PlusExpiringSoonScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlusExpiringSoonScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly feed: NotificationFeedService,
    private readonly cfg: ConfigService,
  ) {}

  onModuleInit() {
    if (this.cfg.get<string>('LOYALTY_EXPIRING_SCHEDULER_ENABLED') !== '1') return;
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        await this.scan();
      } catch (e) {
        this.logger.warn(`expiring-soon scan failed: ${(e as Error).message}`);
      } finally { this.running = false; }
    };
    tick();
    this.timer = setInterval(tick, ONE_HOUR);
    this.timer.unref();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /** Public: callable from the admin controller for on-demand scans. */
  async scan(): Promise<{ scanned: number; emailed: number; skippedAlreadySent: number }> {
    const windowDays = Number(this.cfg.get<string>('LOYALTY_EXPIRING_SOON_DAYS') ?? '7');
    const now = Date.now();
    const cutoff = new Date(now + windowDays * ONE_DAY);

    const rows = await this.prisma.plusMembership.findMany({
      where: {
        status: MembershipStatus.ACTIVE,
        autoRenew: false,
        expiresAt: { gt: new Date(now), lte: cutoff },
        providerSubscriptionId: { not: null },
      },
      take: 500,
    });

    let emailed = 0;
    let skipped = 0;
    for (const m of rows) {
      const periodEnd = m.currentPeriodEnd ?? m.expiresAt;
      const reminderKey = `reminder:${m.id}:${periodEnd.toISOString()}`;
      try {
        await this.prisma.membershipBillingEvent.create({
          data: {
            id: newId(),
            membershipId: m.id,
            providerEventId: reminderKey,
            kind: MembershipBillingEventKind.NOTICE_SENT,
            reason: 'expiring_soon',
            rawSummary: { window: windowDays, expiresAt: periodEnd.toISOString() },
          },
        });
      } catch (e) {
        if ((e as { code?: string })?.code === 'P2002') {
          skipped++;
          continue;
        }
        throw e;
      }
      const user = await this.prisma.user.findUnique({ where: { id: m.userId } });
      if (!user) continue;
      const daysUntilExpiry = Math.max(1, Math.ceil((periodEnd.getTime() - now) / ONE_DAY));
      const base = this.cfg.get<string>('BUYER_WEB_URL') ?? 'http://localhost:3000';
      await this.email.sendToUser(m.userId, 'plus_expiring_soon', {
        firstName: user.firstName,
        daysUntilExpiry,
        expiresOn: fmtDate(periodEnd),
        membershipUrl: `${base}/account/membership`,
      });
      await this.feed.write({
        userId: m.userId,
        kind: NotificationKind.PLUS_EXPIRING_SOON,
        title: `Plus ends in ${daysUntilExpiry} days`,
        body: `Your Onsective Plus benefits end on ${fmtDate(periodEnd)}. Re-enable auto-renew any time before then.`,
        deepLinkPath: '/account/membership',
      });
      emailed++;
    }
    return { scanned: rows.length, emailed, skippedAlreadySent: skipped };
  }
}
