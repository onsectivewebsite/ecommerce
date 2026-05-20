import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectAccountStatus, type Seller } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StripeConnectService } from './stripe-connect.service';

interface ActorMeta {
  userId: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Phase 29: drives the seller-side Stripe Connect Express onboarding
 * flow. Owns the local Seller-row mirror of the Stripe account state
 * and the conversion from raw account flags to ConnectAccountStatus.
 */
@Injectable()
export class SellerOnboardingService {
  private readonly logger = new Logger(SellerOnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeConnectService,
    private readonly audit: AuditService,
    private readonly cfg: ConfigService,
  ) {}

  private apiBase(): string {
    const base = this.cfg.get<string>('API_PUBLIC_URL') ?? this.cfg.get<string>('HOST') ?? 'http://localhost:4000';
    return base.replace(/\/+$/, '');
  }

  private sellerWebBase(): string {
    const base = this.cfg.get<string>('SELLER_WEB_URL') ?? 'http://localhost:3001';
    return base.replace(/\/+$/, '');
  }

  // ---------------- read ----------------

  async statusForUser(userId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) throw new NotFoundException('No seller profile');
    return this.statusOf(seller);
  }

  async statusOf(seller: Seller) {
    return {
      sellerId: seller.id,
      status: seller.connectAccountStatus,
      payoutsEnabled: seller.payoutsEnabled,
      stripeConnectId: seller.stripeConnectId,
      requirementsDue: (seller.connectRequirementsDue ?? []) as string[],
      onboardedAt: seller.connectOnboardedAt?.toISOString() ?? null,
      lastSyncedAt: seller.connectLastSyncedAt?.toISOString() ?? null,
    };
  }

  // ---------------- start onboarding ----------------

  /**
   * Idempotent: creates the Stripe Express account on first call, reuses
   * the stripeConnectId on subsequent calls. Always issues a fresh
   * AccountLink (Stripe links are single-use).
   */
  async startForUser(userId: string, actor: ActorMeta) {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) throw new NotFoundException('No seller profile');
    if (seller.status !== 'APPROVED') {
      throw new BadRequestException('Seller profile must be approved before payouts setup');
    }
    if (seller.connectAccountStatus === ConnectAccountStatus.DISABLED) {
      throw new ForbiddenException('Payouts are disabled on your account — contact support');
    }
    if (!this.stripe.isLive()) {
      throw new BadRequestException('Stripe is not configured on this environment');
    }

    let accountId = seller.stripeConnectId;
    if (!accountId) {
      const email = await this.contactEmailFor(seller);
      const country = seller.originCountry ?? 'US';
      accountId = await this.stripe.createConnectAccount(email, country);
      await this.prisma.seller.update({
        where: { id: seller.id },
        data: {
          stripeConnectId: accountId,
          connectAccountStatus: ConnectAccountStatus.PENDING,
        },
      });
      await this.audit.record({
        actorUserId: actor.userId,
        action: 'seller.connect.account_created',
        entityType: 'Seller',
        entityId: seller.id,
        after: { stripeConnectId: accountId },
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
    }

    const api = this.apiBase();
    const link = await this.stripe.createAccountLink({
      accountId,
      returnUrl: `${api}/seller/onboarding/payouts/return?sellerId=${seller.id}`,
      refreshUrl: `${api}/seller/onboarding/payouts/refresh?sellerId=${seller.id}`,
    });
    return { url: link.url, expiresAt: link.expiresAt.toISOString() };
  }

  // ---------------- sync ----------------

  async syncByStripeAccountId(stripeAccountId: string) {
    const seller = await this.prisma.seller.findFirst({
      where: { stripeConnectId: stripeAccountId },
    });
    if (!seller) return null;
    return this.sync(seller.id);
  }

  async sync(sellerId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { id: sellerId } });
    if (!seller || !seller.stripeConnectId) return null;
    if (!this.stripe.isLive()) return seller;

    const acct = await this.stripe.retrieveAccount(seller.stripeConnectId);
    const status = this.deriveStatus(seller.connectAccountStatus, acct);
    const data: Record<string, unknown> = {
      connectAccountStatus: status,
      payoutsEnabled: status === ConnectAccountStatus.ENABLED && acct.payoutsEnabled,
      connectRequirementsDue: acct.requirementsDue,
      connectLastSyncedAt: new Date(),
    };
    if (status === ConnectAccountStatus.ENABLED && !seller.connectOnboardedAt) {
      data.connectOnboardedAt = new Date();
    }
    return this.prisma.seller.update({
      where: { id: seller.id },
      // Casts are safe: keys match Seller columns.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: data as any,
    });
  }

  private deriveStatus(
    current: ConnectAccountStatus,
    acct: {
      chargesEnabled: boolean;
      payoutsEnabled: boolean;
      detailsSubmitted: boolean;
      disabledReason: string | null;
    },
  ): ConnectAccountStatus {
    // Admin-set DISABLED never gets overwritten by a sync.
    if (current === ConnectAccountStatus.DISABLED) return ConnectAccountStatus.DISABLED;
    if (acct.chargesEnabled && acct.payoutsEnabled) return ConnectAccountStatus.ENABLED;
    if (
      acct.disabledReason &&
      (acct.disabledReason.includes('rejected') ||
        acct.disabledReason === 'rejected.fraud' ||
        acct.disabledReason === 'rejected.terms_of_service' ||
        acct.disabledReason === 'rejected.listed' ||
        acct.disabledReason === 'rejected.other')
    ) {
      return ConnectAccountStatus.REJECTED;
    }
    if (acct.chargesEnabled && !acct.payoutsEnabled) return ConnectAccountStatus.RESTRICTED;
    return ConnectAccountStatus.PENDING;
  }

  // ---------------- dashboard ----------------

  async loginLinkForUser(userId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller || !seller.stripeConnectId) throw new NotFoundException('No Stripe account');
    if (seller.connectAccountStatus !== ConnectAccountStatus.ENABLED) {
      throw new BadRequestException('Complete onboarding before opening the dashboard');
    }
    return this.stripe.createLoginLink(seller.stripeConnectId);
  }

  // ---------------- admin ----------------

  async adminForceSync(sellerId: string) {
    return this.sync(sellerId);
  }

  async adminDisable(sellerId: string, actor: ActorMeta) {
    const seller = await this.prisma.seller.findUnique({ where: { id: sellerId } });
    if (!seller) throw new NotFoundException('Seller not found');
    const updated = await this.prisma.seller.update({
      where: { id: seller.id },
      data: {
        connectAccountStatus: ConnectAccountStatus.DISABLED,
        payoutsEnabled: false,
      },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'seller.connect.disable',
      entityType: 'Seller',
      entityId: seller.id,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return updated;
  }

  // ---------------- helpers ----------------

  private async contactEmailFor(seller: Seller): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: seller.userId },
      select: { email: true },
    });
    if (!user?.email) {
      throw new BadRequestException('Seller is missing a contact email');
    }
    return user.email;
  }

  /** Redirect target for return + refresh handlers. */
  sellerWebReturnUrl(completed: boolean): string {
    return `${this.sellerWebBase()}/seller/onboarding/payouts${completed ? '?completed=1' : ''}`;
  }
}
