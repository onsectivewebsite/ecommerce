import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  type Prisma,
  RefurbUnitAvailability,
  TradeInGrade,
  TradeInOrderStatus,
  TradeInPayoutMethod,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { AuditService } from '../audit/audit.service';
import { WalletService } from '../wallet/wallet.service';
import { NotificationsService } from '../notifications/notifications.service';

interface ActorMeta {
  userId: string;
  ip?: string;
  userAgent?: string;
}

export interface CreateModelInput {
  sourceProductId: string;
  destinationProductId: string;
  baseOfferMinor: number;
  currency: string;
  gradeMultipliers: Record<TradeInGrade, number>;
  accessoryAdjustments: Array<{ key: string; amountMinor: number; label?: string }>;
  assignedRefurbiserId?: string;
}

export interface QuoteInput {
  productSlug: string;
  declaredGrade: TradeInGrade;
  accessories: string[];
}

export interface QuoteResult {
  quoteId: string;
  offerMinor: number;
  currency: string;
  expiresAt: string;
  signature: string;
  modelId: string;
  requiresPhotos: boolean;
}

export interface AcceptQuoteInput extends QuoteResult {
  payoutMethod?: TradeInPayoutMethod;
}

export interface IntakeInput {
  orderId: string;
  photoUrls: string[];
  conditionNotes?: string;
}

export interface GradingInput {
  orderId: string;
  actualGrade: TradeInGrade;
  notes?: string;
  evidenceUrls?: string[];
}

const QUOTE_TTL_MS = 24 * 60 * 60 * 1000;
const HOUSE_SELLER_SLUG = 'onsective-house';

@Injectable()
export class TradeInService {
  private readonly logger = new Logger(TradeInService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly wallet: WalletService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Pick the highest-priority ACTIVE warehouse whose zone covers the buyer's
   * country (and region, if a zone constrains it). Falls back to any active
   * warehouse if no zone matches — trade-ins still need somewhere to land.
   */
  private async chooseInboundWarehouse(country: string, region: string | null): Promise<string | null> {
    const c = country.toUpperCase();
    const r = (region ?? '').toUpperCase();
    const candidates = await this.prisma.warehouse.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { priority: 'asc' },
      include: { zones: true },
    });
    if (candidates.length === 0) return null;
    const zoneMatched = candidates.find((w) =>
      w.zones.some((z) => z.country === c && (z.regions.length === 0 || (r && z.regions.includes(r)))),
    );
    return (zoneMatched ?? candidates[0]).id;
  }

  /**
   * Create a placeholder reverse-shipping label. The real carrier integration
   * lives in ShippingService for outbound; reverse labels are a near-mirror
   * but we keep them local until a buyer-side trade-in mailer is wired up.
   */
  private mockInboundLabel(): { carrier: string; trackingNumber: string; labelUrl: string } {
    const id = newId();
    return {
      carrier: 'mock',
      trackingNumber: `TI-${id.slice(-12)}`,
      labelUrl: `https://labels.onsective.test/trade-in/${id}.pdf`,
    };
  }

  // ---------------- model catalog ----------------

  listModels() {
    return this.prisma.tradeInModel.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        sourceProduct: { select: { id: true, slug: true, title: true } },
        destinationProduct: { select: { id: true, slug: true, title: true, condition: true } },
        assignedRefurbiser: { select: { id: true, displayName: true } },
      },
    });
  }

  async createModel(input: CreateModelInput, actor: ActorMeta) {
    const src = await this.prisma.product.findUnique({ where: { id: input.sourceProductId } });
    if (!src) throw new BadRequestException('Source product not found');
    const dest = await this.prisma.product.findUnique({ where: { id: input.destinationProductId } });
    if (!dest) throw new BadRequestException('Destination product not found');
    if (dest.condition === 'NEW_GENUINE') {
      throw new BadRequestException('Destination must be a REFURB_GRADE_* product');
    }
    if (input.baseOfferMinor <= 0) throw new BadRequestException('baseOfferMinor must be > 0');

    const created = await this.prisma.tradeInModel.create({
      data: {
        id: newId(),
        sourceProductId: input.sourceProductId,
        destinationProductId: input.destinationProductId,
        baseOfferMinor: input.baseOfferMinor,
        currency: input.currency.toUpperCase(),
        gradeMultipliers: input.gradeMultipliers as unknown as object,
        accessoryAdjustments: input.accessoryAdjustments as unknown as object,
        assignedRefurbiserId: input.assignedRefurbiserId ?? null,
      },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'tradein.model.create',
      entityType: 'TradeInModel',
      entityId: created.id,
      after: { sourceProductId: input.sourceProductId, destinationProductId: input.destinationProductId },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return created;
  }

  // ---------------- quotes ----------------

  /**
   * Issue a signed quote. We don't persist the quote — the signature is the
   * proof. Acceptance verifies it. Cheap revocation by rotating the key.
   */
  async quote(input: QuoteInput): Promise<QuoteResult> {
    const product = await this.prisma.product.findUnique({
      where: { slug: input.productSlug },
      include: { tradeInModelsAsSource: true },
    });
    if (!product) throw new NotFoundException('Product not found');
    const model = product.tradeInModelsAsSource.find((m) => m.enabled);
    if (!model) throw new NotFoundException('No active trade-in offer for this product');

    const offerMinor = this.computeOffer(model, input.declaredGrade, input.accessories);
    if (offerMinor <= 0) {
      throw new BadRequestException('No payout available for that condition/accessories');
    }

    const quoteId = newId();
    const expiresAt = new Date(Date.now() + QUOTE_TTL_MS).toISOString();
    const signature = this.sign({
      quoteId,
      offerMinor,
      currency: model.currency,
      modelId: model.id,
      declaredGrade: input.declaredGrade,
      accessories: input.accessories,
      expiresAt,
    });
    return {
      quoteId,
      offerMinor,
      currency: model.currency,
      expiresAt,
      signature,
      modelId: model.id,
      requiresPhotos: input.declaredGrade === TradeInGrade.GRADE_A,
    };
  }

  private computeOffer(
    model: { baseOfferMinor: number; gradeMultipliers: unknown; accessoryAdjustments: unknown },
    grade: TradeInGrade,
    accessories: string[],
  ): number {
    const multipliers = (model.gradeMultipliers as Record<string, number>) ?? {};
    const adj = (model.accessoryAdjustments as Array<{ key: string; amountMinor: number }>) ?? [];
    const mult = Number(multipliers[grade] ?? 0);
    let offer = Math.round(model.baseOfferMinor * mult);
    for (const a of adj) {
      if (accessories.includes(a.key)) offer += a.amountMinor;
    }
    if (offer < 0) offer = 0;
    if (offer > model.baseOfferMinor) offer = model.baseOfferMinor;
    return offer;
  }

  private sign(payload: Record<string, unknown>): string {
    const secret = this.config.get<string>('TRADEIN_QUOTE_SECRET') ?? 'dev-only-not-for-prod';
    const msg = JSON.stringify(payload, Object.keys(payload).sort());
    return createHmac('sha256', secret).update(msg).digest('hex');
  }

  private verify(payload: Record<string, unknown>, signature: string): boolean {
    const expected = this.sign(payload);
    if (expected.length !== signature.length) return false;
    try {
      return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
    } catch { return false; }
  }

  // ---------------- order accept ----------------

  async acceptQuote(
    buyerUserId: string,
    input: AcceptQuoteInput & { declaredGrade: TradeInGrade; accessories: string[]; modelId: string },
    actor: ActorMeta,
  ) {
    if (new Date(input.expiresAt).getTime() <= Date.now()) {
      throw new BadRequestException('Quote has expired');
    }
    const ok = this.verify(
      {
        quoteId: input.quoteId,
        offerMinor: input.offerMinor,
        currency: input.currency,
        modelId: input.modelId,
        declaredGrade: input.declaredGrade,
        accessories: input.accessories,
        expiresAt: input.expiresAt,
      },
      input.signature,
    );
    if (!ok) throw new BadRequestException('Invalid quote signature');

    const model = await this.prisma.tradeInModel.findUnique({
      where: { id: input.modelId },
      include: { assignedRefurbiser: true },
    });
    if (!model || !model.enabled) throw new BadRequestException('Model no longer accepting trade-ins');

    // Routing: pick a warehouse. If the model is assigned to a refurbisher,
    // route to one of their warehouses; otherwise platform.
    const buyer = await this.prisma.user.findUnique({
      where: { id: buyerUserId },
      include: { addresses: { where: { isDefault: true }, take: 1 } },
    });
    const buyerCountry = buyer?.addresses[0]?.country ?? 'US';
    const warehouseId = await this.chooseInboundWarehouse(
      buyerCountry,
      buyer?.addresses[0]?.region ?? null,
    );
    if (!warehouseId) {
      throw new BadRequestException('No warehouse available in your region for trade-in');
    }

    const label = this.mockInboundLabel();
    const order = await this.prisma.tradeInOrder.create({
      data: {
        id: newId(),
        buyerUserId,
        modelId: model.id,
        warehouseId,
        status: TradeInOrderStatus.KIT_SHIPPED,
        declaredGrade: input.declaredGrade,
        accessories: input.accessories,
        offerMinor: input.offerMinor,
        currency: input.currency,
        payoutMethod: input.payoutMethod ?? TradeInPayoutMethod.WALLET,
        shipBackTracking: label.trackingNumber,
        shipBackLabelUrl: label.labelUrl,
        shipBackCarrier: label.carrier,
      },
    });

    await this.audit.record({
      actorUserId: actor.userId,
      action: 'tradein.order.create',
      entityType: 'TradeInOrder',
      entityId: order.id,
      after: { modelId: model.id, offerMinor: input.offerMinor },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    this.events.emit('tradein.order.created', { orderId: order.id });
    return order;
  }

  // ---------------- buyer reads / cancel ----------------

  listMine(buyerUserId: string) {
    return this.prisma.tradeInOrder.findMany({
      where: { buyerUserId },
      orderBy: { createdAt: 'desc' },
      include: {
        model: { include: { sourceProduct: { select: { slug: true, title: true } } } },
      },
    });
  }

  async cancel(buyerUserId: string, orderId: string, actor: ActorMeta) {
    const order = await this.prisma.tradeInOrder.findUnique({ where: { id: orderId } });
    if (!order || order.buyerUserId !== buyerUserId) throw new NotFoundException();
    if (
      order.status === TradeInOrderStatus.RECEIVED ||
      order.status === TradeInOrderStatus.GRADED ||
      order.status === TradeInOrderStatus.PAID
    ) {
      throw new BadRequestException('Order already at warehouse — cannot cancel');
    }
    const updated = await this.prisma.tradeInOrder.update({
      where: { id: orderId },
      data: { status: TradeInOrderStatus.CANCELLED, cancelledAt: new Date() },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'tradein.order.cancel',
      entityType: 'TradeInOrder',
      entityId: orderId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return updated;
  }

  // ---------------- warehouse intake + grading ----------------

  intakeQueue(warehouseId?: string) {
    return this.prisma.tradeInOrder.findMany({
      where: {
        warehouseId,
        status: { in: [TradeInOrderStatus.KIT_SHIPPED, TradeInOrderStatus.IN_TRANSIT, TradeInOrderStatus.RECEIVED] },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        buyer: { select: { id: true, email: true } },
        model: { include: { sourceProduct: { select: { slug: true, title: true } } } },
        intake: true,
      },
    });
  }

  async recordIntake(input: IntakeInput, actor: ActorMeta) {
    const order = await this.prisma.tradeInOrder.findUnique({ where: { id: input.orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === TradeInOrderStatus.RECEIVED || order.status === TradeInOrderStatus.GRADED || order.status === TradeInOrderStatus.PAID) {
      throw new BadRequestException(`Order already ${order.status}`);
    }
    const intake = await this.prisma.tradeInIntake.create({
      data: {
        id: newId(),
        orderId: input.orderId,
        technicianUserId: actor.userId,
        photoUrls: input.photoUrls,
        conditionNotes: input.conditionNotes ?? null,
      },
    });
    await this.prisma.tradeInOrder.update({
      where: { id: input.orderId },
      data: { status: TradeInOrderStatus.RECEIVED, receivedAt: new Date() },
    });
    this.events.emit('tradein.order.received', { orderId: input.orderId });
    return intake;
  }

  async grade(input: GradingInput, actor: ActorMeta) {
    const order = await this.prisma.tradeInOrder.findUnique({
      where: { id: input.orderId },
      include: {
        model: { include: { destinationProduct: true, assignedRefurbiser: true } },
        buyer: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== TradeInOrderStatus.RECEIVED) {
      throw new BadRequestException('Order must be RECEIVED before grading');
    }

    const isReject = input.actualGrade === TradeInGrade.REJECT;

    // Recompute payout against the actual grade — this is what prevents
    // overstating the declared grade for a bigger up-front quote.
    const payoutMinor = isReject
      ? 0
      : this.computeOffer(order.model, input.actualGrade, order.accessories);

    // Phase 16: surface AI/human divergence in the grading notes for audit.
    const aiNote = await this.maybeGradeDivergenceNote(order.id, input.actualGrade);
    const noteWithAi = aiNote
      ? `${input.notes ?? ''}${input.notes ? ' | ' : ''}${aiNote}`.trim()
      : input.notes ?? null;

    return this.prisma.$transaction(async (tx) => {
      const grading = await tx.tradeInGrading.create({
        data: {
          id: newId(),
          orderId: order.id,
          technicianUserId: actor.userId,
          actualGrade: input.actualGrade,
          payoutMinor,
          notes: noteWithAi,
          evidenceUrls: input.evidenceUrls ?? [],
        },
      });

      const data: Prisma.TradeInOrderUpdateInput = {
        actualGrade: input.actualGrade,
        finalPayoutMinor: payoutMinor,
        gradedAt: new Date(),
        status: isReject ? TradeInOrderStatus.REJECTED : TradeInOrderStatus.GRADED,
        rejectionReason: isReject ? (input.notes ?? 'Rejected on inspection') : null,
      };

      let refurbUnitId: string | null = null;
      if (!isReject) {
        // Auto-create the RefurbUnit on the destination product. It enters as
        // QUARANTINED so the Phase 14 AuthenticityCheck gate still runs before
        // it's available for sale — single chokepoint for "live stock".
        const sellerId = await this.resolveSellerForRefurb(tx, order.model.assignedRefurbiser?.id);
        const unitId = newId();
        const variantId = newId();
        const serial = `TI-${order.id.slice(-8)}`.toUpperCase();
        const handlingMargin = Math.max(Math.round(payoutMinor * 0.4), 2500);
        const retailPriceMinor = Math.max(payoutMinor + handlingMargin, payoutMinor + 1000);

        const variant = await tx.productVariant.create({
          data: {
            id: variantId,
            productId: order.model.destinationProductId,
            sku: `TI-${unitId.slice(-8)}`.toUpperCase().slice(0, 64),
            name: `Trade-in unit ${serial}`,
            priceMinor: retailPriceMinor,
            inventoryQty: 0, // auth check will bump to 1
            weightGrams: 0,
            attributes: { refurbUnitId: unitId, source: 'trade-in', tradeInOrderId: order.id } as object,
          },
        });
        await tx.refurbUnit.create({
          data: {
            id: unitId,
            productId: order.model.destinationProductId,
            sellerId,
            warehouseId: order.warehouseId,
            serialNumber: serial,
            priceMinor: retailPriceMinor,
            currency: order.currency,
            conditionReport: { source: 'trade-in', grade: input.actualGrade, notes: input.notes ?? null } as object,
            availability: RefurbUnitAvailability.QUARANTINED,
            warrantyMonths: input.actualGrade === 'GRADE_A' ? 12 : input.actualGrade === 'GRADE_B' ? 6 : 1,
            variantId: variant.id,
          },
        });
        refurbUnitId = unitId;
        data.refurbUnitId = unitId;
      }

      const updated = await tx.tradeInOrder.update({ where: { id: order.id }, data });

      // Payout (wallet credit by default). Stripe path is opt-in; in dev mode
      // the payments adapter no-ops so the flow still completes.
      if (!isReject && payoutMinor > 0) {
        if (order.payoutMethod === TradeInPayoutMethod.WALLET) {
          await this.wallet.applyDelta({
            userId: order.buyerUserId,
            amountMinor: payoutMinor,
            kind: 'CREDIT_GRANT',
            reason: `Trade-in payout (order ${order.id})`,
            currency: order.currency,
          });
        }
        await tx.tradeInOrder.update({
          where: { id: order.id },
          data: { status: TradeInOrderStatus.PAID, paidAt: new Date() },
        });
      }

      await this.audit.record({
        actorUserId: actor.userId,
        action: isReject ? 'tradein.grade.reject' : 'tradein.grade.approve',
        entityType: 'TradeInGrading',
        entityId: grading.id,
        after: { orderId: order.id, actualGrade: input.actualGrade, payoutMinor, refurbUnitId },
        ip: actor.ip,
        userAgent: actor.userAgent,
      });

      // Notify buyer.
      this.notifications.sendToUser(order.buyerUserId, {
        title: isReject ? 'Trade-in rejected' : `Trade-in paid: ${(payoutMinor / 100).toFixed(2)} ${order.currency}`,
        body: isReject
          ? (input.notes ?? 'Your device did not pass our grading.')
          : 'Your trade-in payout is in your wallet. The device will be re-listed after authentication.',
        data: { screen: 'TradeIns', orderId: order.id },
        categoryId: 'trade_in_update',
      }).catch(() => undefined);

      this.events.emit(isReject ? 'tradein.order.rejected' : 'tradein.order.paid', {
        orderId: order.id,
        refurbUnitId,
      });

      return updated;
    });
  }

  /**
   * Resolve the seller that owns a re-listed RefurbUnit: either the assigned
   * refurbisher, or the platform house seller. The house seller is created
   * lazily on first call.
   */
  private async resolveSellerForRefurb(
    tx: Prisma.TransactionClient,
    assignedSellerId?: string | null,
  ): Promise<string> {
    if (assignedSellerId) return assignedSellerId;
    const existing = await tx.seller.findUnique({ where: { storeName: HOUSE_SELLER_SLUG } });
    if (existing) return existing.id;
    // Lazy house-seller bootstrap. Uses the first ADMIN user as the userId
    // anchor since house-seller doesn't have its own login.
    const admin = await tx.user.findFirst({ where: { role: 'ADMIN' } });
    if (!admin) {
      throw new BadRequestException(
        'No admin user found — cannot bootstrap the house seller for trade-in re-listing',
      );
    }
    return (await tx.seller.create({
      data: {
        id: newId(),
        userId: admin.id,
        storeName: HOUSE_SELLER_SLUG,
        displayName: 'Onsective',
        status: 'APPROVED',
        payoutCurrency: 'USD',
      },
    })).id;
  }

  /**
   * Phase 16: if the most recent AI GRADE run for this order disagrees with
   * the technician's actual grade, return a short note recording the override.
   */
  private async maybeGradeDivergenceNote(
    orderId: string,
    actualGrade: TradeInGrade,
  ): Promise<string | null> {
    const run = await this.prisma.aiInferenceRun.findFirst({
      where: { kind: 'GRADE', inputRefKind: 'tradeInOrder', inputRefId: orderId },
      orderBy: { createdAt: 'desc' },
    });
    if (!run) return null;
    const result = run.result as { suggestedGrade?: TradeInGrade; confidence?: number };
    if (!result?.suggestedGrade || result.suggestedGrade === actualGrade) return null;
    const conf = typeof result.confidence === 'number' ? ` (${(result.confidence * 100).toFixed(0)}%)` : '';
    return `AI suggested ${result.suggestedGrade}${conf}; human overrode to ${actualGrade} [run:${run.id}]`;
  }
}
