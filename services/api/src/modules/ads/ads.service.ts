import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AdCampaignStatus, AdPlacementType, AdPricingModel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { PaymentsService } from '../payments/payments.service';
import { newId } from '../../common/id';

export interface CreateCampaignInput {
  name: string;
  pricingModel: AdPricingModel;
  bidMinor: number;
  currency?: string;
  dailyBudgetMinor?: number;
  totalBudgetMinor?: number;
  priority?: number;
  startsAt?: Date | null;
  endsAt?: Date | null;
}

export interface CreatePlacementInput {
  type: AdPlacementType;
  productId?: string;
  assetId?: string;
  searchKeyword?: string;
  categorySlug?: string;
  weight?: number;
  destinationUrl?: string;
}

export interface RecordImpressionInput {
  campaignId: string;
  placementId: string;
  buyerSessionId?: string;
  eventKey?: string;
}

@Injectable()
export class AdsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly payments: PaymentsService,
  ) {}

  // ----- Seller-facing CRUD -----

  private async sellerFor(userId: string) {
    const s = await this.prisma.seller.findUnique({ where: { userId } });
    if (!s) throw new NotFoundException('No seller profile');
    return s;
  }

  async listCampaigns(userId: string) {
    const seller = await this.sellerFor(userId);
    return this.prisma.adCampaign.findMany({
      where: { sellerId: seller.id },
      orderBy: { createdAt: 'desc' },
      include: { placements: { include: { product: true } } },
    });
  }

  async getCampaign(userId: string, id: string) {
    const seller = await this.sellerFor(userId);
    const c = await this.prisma.adCampaign.findUnique({
      where: { id },
      include: { placements: { include: { product: true } }, events: { take: 50, orderBy: { occurredAt: 'desc' } } },
    });
    if (!c) throw new NotFoundException('Campaign not found');
    if (c.sellerId !== seller.id) throw new ForbiddenException('Not your campaign');
    return c;
  }

  async createCampaign(userId: string, input: CreateCampaignInput) {
    const seller = await this.sellerFor(userId);
    return this.prisma.adCampaign.create({
      data: {
        id: newId(),
        sellerId: seller.id,
        name: input.name,
        status: 'DRAFT',
        pricingModel: input.pricingModel,
        bidMinor: input.bidMinor,
        currency: input.currency ?? 'USD',
        dailyBudgetMinor: input.dailyBudgetMinor ?? 0,
        totalBudgetMinor: input.totalBudgetMinor ?? 0,
        priority: input.priority ?? 1,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
      },
    });
  }

  async updateCampaign(userId: string, id: string, patch: Partial<CreateCampaignInput> & { status?: AdCampaignStatus }) {
    await this.getCampaign(userId, id);
    return this.prisma.adCampaign.update({
      where: { id },
      data: {
        name: patch.name,
        pricingModel: patch.pricingModel,
        bidMinor: patch.bidMinor,
        currency: patch.currency,
        dailyBudgetMinor: patch.dailyBudgetMinor,
        totalBudgetMinor: patch.totalBudgetMinor,
        priority: patch.priority,
        startsAt: patch.startsAt,
        endsAt: patch.endsAt,
        status: patch.status,
      },
    });
  }

  async addPlacement(userId: string, campaignId: string, input: CreatePlacementInput) {
    const campaign = await this.getCampaign(userId, campaignId);
    if (input.productId) {
      // ensure product belongs to this seller
      const prod = await this.prisma.product.findUnique({ where: { id: input.productId } });
      if (!prod || prod.sellerId !== campaign.sellerId) {
        throw new BadRequestException('Product not in your catalog');
      }
    }
    return this.prisma.adPlacement.create({
      data: {
        id: newId(),
        campaignId,
        type: input.type,
        productId: input.productId,
        assetId: input.assetId,
        searchKeyword: input.searchKeyword?.toLowerCase(),
        categorySlug: input.categorySlug,
        weight: input.weight ?? 1,
        destinationUrl: input.destinationUrl,
      },
    });
  }

  async deletePlacement(userId: string, id: string) {
    const p = await this.prisma.adPlacement.findUnique({ where: { id }, include: { campaign: true } });
    if (!p) throw new NotFoundException('Placement not found');
    const seller = await this.sellerFor(userId);
    if (p.campaign.sellerId !== seller.id) throw new ForbiddenException();
    await this.prisma.adPlacement.delete({ where: { id } });
    return { ok: true };
  }

  // ----- Ad budget top-up -----

  async startTopUp(userId: string, amountMinor: number, provider: 'mock' | 'stripe') {
    if (amountMinor <= 0) throw new BadRequestException('amountMinor must be > 0');
    const seller = await this.sellerFor(userId);
    const gateway = this.payments.resolve(provider);
    const intent = await gateway.createIntent({
      orderId: `adtopup_${seller.id}_${Date.now()}`,
      amountMinor,
      currency: 'USD',
      buyerEmail: 'ads@onsective.com',
    });
    if (provider === 'mock') {
      // For dev, capture inline and credit the budget immediately.
      await this.ledger.bookAdTopUp({
        sellerId: seller.id,
        amountMinor,
        currency: 'USD',
        paymentRef: intent.providerRef,
      });
      return { instant: true, paymentRef: intent.providerRef, clientSecret: null };
    }
    // Stripe path: production replaces this with a dedicated webhook → bookAdTopUp.
    return { instant: false, paymentRef: intent.providerRef, clientSecret: intent.clientSecret ?? null };
  }

  async budgetBalance(userId: string): Promise<{ availableMinor: number; currency: string }> {
    const seller = await this.sellerFor(userId);
    const bal = await this.ledger.balanceOf('SELLER_AD_BUDGET', seller.id, 'USD');
    return { availableMinor: bal.balanceMinor, currency: 'USD' };
  }

  // ----- Event recording -----

  async recordImpression(input: RecordImpressionInput) {
    const { campaign, placement } = await this.loadEventTargets(input.campaignId, input.placementId);
    if (input.eventKey) {
      const existing = await this.prisma.adEvent.findUnique({ where: { eventKey: input.eventKey } });
      if (existing) return existing;
    }
    const amountMinor = campaign.pricingModel === 'CPM' ? Math.max(1, Math.round(campaign.bidMinor / 1000)) : 0;
    const event = await this.prisma.adEvent.create({
      data: {
        id: newId(),
        campaignId: campaign.id,
        placementId: placement.id,
        type: 'IMPRESSION',
        buyerSessionId: input.buyerSessionId,
        amountMinor,
        currency: campaign.currency,
        eventKey: input.eventKey,
      },
    });
    if (amountMinor > 0) {
      await this.ledger.bookAdCharge({
        sellerId: campaign.sellerId,
        eventId: event.id,
        amountMinor,
        currency: campaign.currency,
      });
      await this.bumpSpend(campaign.id, amountMinor);
    }
    return event;
  }

  /**
   * Record a click and return the destination URL to redirect to.
   * Charges CPC if applicable.
   */
  async recordClick(placementId: string, buyerSessionId?: string, eventKey?: string): Promise<{ destinationUrl: string }> {
    const placement = await this.prisma.adPlacement.findUnique({
      where: { id: placementId },
      include: { campaign: true, product: true },
    });
    if (!placement) throw new NotFoundException('Placement not found');
    const campaign = placement.campaign;
    const dest = placement.destinationUrl ?? (placement.product ? `/p/${placement.product.slug}` : '/');
    if (eventKey) {
      const existing = await this.prisma.adEvent.findUnique({ where: { eventKey } });
      if (existing) return { destinationUrl: dest };
    }
    const amountMinor = campaign.pricingModel === 'CPC' ? campaign.bidMinor : 0;
    const event = await this.prisma.adEvent.create({
      data: {
        id: newId(),
        campaignId: campaign.id,
        placementId: placement.id,
        type: 'CLICK',
        buyerSessionId,
        amountMinor,
        currency: campaign.currency,
        eventKey,
      },
    });
    if (amountMinor > 0) {
      await this.ledger.bookAdCharge({
        sellerId: campaign.sellerId,
        eventId: event.id,
        amountMinor,
        currency: campaign.currency,
      });
      await this.bumpSpend(campaign.id, amountMinor);
    }
    return { destinationUrl: dest };
  }

  private async loadEventTargets(campaignId: string, placementId: string) {
    const placement = await this.prisma.adPlacement.findUnique({
      where: { id: placementId },
      include: { campaign: true },
    });
    if (!placement || placement.campaignId !== campaignId) throw new BadRequestException('placement/campaign mismatch');
    return { campaign: placement.campaign, placement };
  }

  private async bumpSpend(campaignId: string, deltaMinor: number) {
    const c = await this.prisma.adCampaign.update({
      where: { id: campaignId },
      data: { spentMinor: { increment: deltaMinor } },
    });
    if (c.totalBudgetMinor > 0 && c.spentMinor >= c.totalBudgetMinor) {
      await this.prisma.adCampaign.update({
        where: { id: campaignId },
        data: { status: 'EXHAUSTED' },
      });
    }
  }
}
