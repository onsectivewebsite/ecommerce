import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { SettingsService } from '../settings/settings.service';
import { UsersService } from '../users/users.service';
import { PaymentsService } from '../payments/payments.service';
import { PaymentMethodsService } from '../payments/payment-methods.service';
import { PaymentAuthenticationRequiredError } from '../payments/gateway';
import { ShippingService } from '../shipping/shipping.service';
import { InventoryService } from '../inventory/inventory.service';
import { ComplianceGateService } from '../compliance/compliance-gate.service';
import { TaxEngine } from '../tax/tax.engine';
import { PromotionsService } from '../promotions/promotions.service';
import { WalletService } from '../wallet/wallet.service';
import { RiskEngine } from '../risk/risk.engine';
import { RoutingService } from '../fulfillment/routing.service';
import { SlaService } from '../sla/sla.service';
import { RefurbUnitsService } from '../refurb-units/refurb-units.service';
import { MembershipService } from '../loyalty/membership.service';
import type { CheckoutDto } from './dto';
import type { CarrierCode } from '../shipping/carriers/types';
import type {
  AddressDto,
  OrderDto,
  PaymentProvider,
  PaymentStatus,
  CurrencyCode,
  OrderStatus,
} from '@onsective/shared-types';

function addressToDto(a: any): AddressDto {
  return {
    id: a.id,
    fullName: a.fullName,
    line1: a.line1,
    line2: a.line2 ?? null,
    city: a.city,
    region: a.region,
    postalCode: a.postalCode,
    country: a.country,
    phone: a.phone ?? null,
    isDefault: a.isDefault,
  };
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly users: UsersService,
    private readonly payments: PaymentsService,
    private readonly shipping: ShippingService,
    private readonly inventory: InventoryService,
    private readonly compliance: ComplianceGateService,
    private readonly tax: TaxEngine,
    private readonly promotions: PromotionsService,
    private readonly wallet: WalletService,
    private readonly events: EventEmitter2,
    private readonly risk: RiskEngine,
    private readonly routing: RoutingService,
    private readonly refurbUnits: RefurbUnitsService,
    private readonly sla: SlaService,
    private readonly membership: MembershipService,
    private readonly paymentMethods: PaymentMethodsService,
  ) {}

  async checkout(userId: string, dto: CheckoutDto): Promise<OrderDto> {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      include: {
        items: { include: { variant: { include: { product: { include: { seller: true, category: true } } } } } },
      },
    });
    if (!cart || cart.items.length === 0) throw new BadRequestException('Cart is empty');

    // Single-seller orders only for now (split-tender lands in Phase 4).
    const sellerIds = new Set(cart.items.map((i) => i.variant.product.sellerId));
    if (sellerIds.size > 1) {
      throw new BadRequestException(
        'Currently supporting single-seller orders. Please check out per seller.',
      );
    }
    const sellerId = [...sellerIds][0]!;

    // Re-validate prices and stock
    for (const item of cart.items) {
      if (item.variant.product.status !== 'ACTIVE') {
        throw new BadRequestException(`"${item.variant.product.title}" is no longer available`);
      }
      if (item.variant.priceMinor !== item.unitPriceMinor) {
        throw new BadRequestException(`Price changed for ${item.variant.product.title}`);
      }
      if (item.variant.inventoryQty < item.qty) {
        throw new BadRequestException(`Only ${item.variant.inventoryQty} of ${item.variant.product.title} in stock`);
      }
    }

    const shippingAddress = await this.users.getAddressOrThrow(userId, dto.shippingAddressId);
    const billingAddress = dto.billingAddressId
      ? await this.users.getAddressOrThrow(userId, dto.billingAddressId)
      : shippingAddress;

    // Phase 5: compliance gate — age, country, seller doc, and digital-key inventory.
    await this.compliance.gateOrder(
      { userId, shippingCountry: shippingAddress.country },
      cart.items.map((i) => ({ productId: i.variant.product.id, qty: i.qty })),
    );

    // Reject cleanly if a digital LICENSE_KEY line has no available keys in the pool.
    for (const item of cart.items) {
      const product = item.variant.product;
      if (!product.isDigital) continue;
      const dp = await this.prisma.digitalProduct.findUnique({
        where: { productId: product.id },
      });
      if (dp?.type === 'LICENSE_KEY') {
        const available = await this.prisma.licenseKey.count({
          where: { digitalProductId: dp.id, status: 'AVAILABLE' },
        });
        if (available < item.qty) {
          throw new ConflictException(
            `Only ${available} license key(s) currently available for "${product.title}". ` +
              `Please reduce quantity or come back shortly — the seller has been notified.`,
          );
        }
      }
    }

    const subtotalMinor = cart.items.reduce((s, i) => s + i.unitPriceMinor * i.qty, 0);

    // Phase 5: digital-only orders skip shipping entirely.
    const isAllDigitalEarly = cart.items.every((i) => i.variant.product.isDigital);

    // Phase 2: shipping choice can come from a buyer-provided carrier quote.
    // Falls back to flat-rate setting if none was selected (degraded mode).
    let shippingMinor: number;
    let shippingCarrier: string | null = null;
    let shippingService: string | null = null;
    if (isAllDigitalEarly) {
      shippingMinor = 0;
    } else if (dto.shippingCarrier && dto.shippingService && typeof dto.shippingAmountMinor === 'number') {
      shippingMinor = dto.shippingAmountMinor;
      shippingCarrier = dto.shippingCarrier;
      shippingService = dto.shippingService;
    } else {
      shippingMinor = Number(await this.settings.getInt('platform.flat_shipping.minor'));
    }

    const seller = await this.prisma.seller.findUnique({ where: { id: sellerId } });
    if (!seller || seller.status !== 'APPROVED') {
      throw new BadRequestException('Seller cannot accept orders');
    }

    // Phase 6: pluggable tax engine, replacing the flat-bps from Phase 1.
    const taxResult = await this.tax.resolveForOrder({
      country: shippingAddress.country,
      region: shippingAddress.region,
      postalCode: shippingAddress.postalCode,
      sellerCountry: seller.originCountry ?? undefined,
      sellerRegion: seller.originRegion ?? undefined,
      currency: cart.currency,
      baseMinor: subtotalMinor + shippingMinor,
      items: cart.items.map((i) => ({
        productId: i.variant.product.id,
        categorySlug: i.variant.product.category.slug,
        lineSubtotalMinor: i.unitPriceMinor * i.qty,
        qty: i.qty,
      })),
    });
    const taxMinor = taxResult.totalMinor;
    const taxLines = taxResult.lines;

    // Phase 10: evaluate promotion codes against the realized line items.
    const promoEval = await this.promotions.evaluate(
      userId,
      dto.promotionCodes ?? [],
      {
        subtotalMinor,
        currency: cart.currency,
        lines: cart.items.map((i) => ({
          productId: i.variant.productId,
          sellerId: i.variant.product.sellerId,
          qty: i.qty,
          unitPriceMinor: i.unitPriceMinor,
          lineSubtotalMinor: i.unitPriceMinor * i.qty,
        })),
      },
    );
    const promoDiscountMinor = promoEval.totalDiscountMinor;
    // Phase 22: ACTIVE Plus members get free shipping on every order — we
    // still keep `shippingMinor` for the carrier label cost, but the buyer
    // pays $0.
    const isPlusMember = await this.membership.isActiveForUser(userId);
    const effectiveShipping = promoEval.freeShipping || isPlusMember ? 0 : shippingMinor;
    const preWalletTotal = Math.max(0, subtotalMinor - promoDiscountMinor) + effectiveShipping + taxMinor;

    // Phase 10: clamp wallet apply to (available balance, preWalletTotal).
    let walletAppliedMinor = 0;
    if (dto.walletAmountMinor && dto.walletAmountMinor > 0) {
      const balance = await this.wallet.balance(userId);
      walletAppliedMinor = Math.min(dto.walletAmountMinor, balance, preWalletTotal);
    }
    const totalMinor = preWalletTotal - walletAppliedMinor;

    const commissionBps = seller.commissionBps ?? Number(await this.settings.getInt('platform.commission.bps'));
    // Commission is computed on the net subtotal the seller actually realizes
    // — pre-tax/shipping, post seller-discount. Platform-funded promotions
    // (e.g., signup credit) do not reduce the seller's commission base.
    const sellerDiscountMinor = promoEval.discountLines
      .filter((d) => d.scope === 'SELLER')
      .reduce((s, d) => s + d.amountMinor, 0);
    const commissionBase = Math.max(0, subtotalMinor - sellerDiscountMinor);
    const commissionMinor = Math.round((commissionBase * commissionBps) / 10000);

    // Phase 21: per-item routing. Lines get tagged with their own
    // fulfilledFromWarehouseId; SELLER-mode lines stay null. Items that no
    // warehouse can cover fall back to seller-fulfilled per line.
    const perItemRoutes = await this.routing.chooseForOrderPerItem({
      country: shippingAddress.country,
      region: shippingAddress.region,
      lines: cart.items.map((i) => ({
        variantId: i.variantId,
        productId: i.variant.productId,
        fulfillmentMode: i.variant.product.fulfillmentMode as 'SELLER' | 'PLATFORM',
        qty: i.qty,
      })),
    });
    const routeByVariant = new Map(perItemRoutes.map((r) => [r.variantId, r]));

    // Pre-resolve refurb-unit links per cart item so we can both write the
    // OrderItem.refurbUnitId field and atomically mark each unit SOLD inside
    // the order-creation transaction.
    const refurbLinks = new Map<string, string>(); // variantId -> refurbUnitId
    for (const i of cart.items) {
      const ru = await this.prisma.refurbUnit.findUnique({
        where: { variantId: i.variantId },
        select: { id: true },
      });
      if (ru) {
        if (i.qty !== 1) {
          throw new BadRequestException('Refurb units are sold one at a time');
        }
        refurbLinks.set(i.variantId, ru.id);
      }
    }

    const itemIds = new Map<string, string>(); // variantId -> orderItemId (preassigned)
    for (const i of cart.items) itemIds.set(i.variantId, newId());

    const order = await this.prisma.$transaction(async (tx) => {
      // decrement inventory
      for (const item of cart.items) {
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: { inventoryQty: { decrement: item.qty } },
        });
      }
      const created = await tx.order.create({
        data: {
          id: newId(),
          userId,
          sellerId,
          status: 'PENDING',
          currency: cart.currency,
          subtotalMinor,
          shippingMinor: effectiveShipping,
          taxMinor,
          totalMinor,
          commissionMinor,
          taxLines: taxLines as unknown as object,
          promotionLines: promoEval.discountLines.map((d) => ({
            code: d.code,
            kind: d.kind,
            scope: d.scope,
            amountMinor: d.amountMinor,
          })) as unknown as object,
          walletAppliedMinor,
          shippingAddressId: shippingAddress.id,
          billingAddressId: billingAddress.id,
          shippingCarrier,
          shippingService,
          items: {
            create: cart.items.map((i) => {
              const r = routeByVariant.get(i.variantId);
              const isPlatform = i.variant.product.fulfillmentMode === 'PLATFORM';
              const warehouseId = isPlatform ? (r?.warehouseId ?? null) : null;
              const promise = warehouseId
                ? this.sla.snapshotPromise(r?.slaProfile ?? null)
                : { promisedShipBy: null, promisedDeliverBy: null, slaWindowDays: null };
              return {
                id: itemIds.get(i.variantId)!,
                variantId: i.variantId,
                productTitleSnapshot: i.variant.product.title,
                variantNameSnapshot: i.variant.name,
                unitPriceMinor: i.unitPriceMinor,
                qty: i.qty,
                lineSubtotalMinor: i.unitPriceMinor * i.qty,
                refurbUnitId: refurbLinks.get(i.variantId) ?? null,
                fulfilledFromWarehouseId: warehouseId,
                promisedShipBy: promise.promisedShipBy,
                promisedDeliverBy: promise.promisedDeliverBy,
                slaWindowDays: promise.slaWindowDays,
              };
            }),
          },
        },
        include: { items: true, shippingAddress: true, billingAddress: true, seller: true },
      });
      // Phase 14: atomically transition each refurb unit to SOLD. The guard
      // `availability IN (RESERVED-by-this-cart, AVAILABLE)` ensures two
      // buyers cannot race for the same physical unit.
      for (const [variantId, refurbUnitId] of refurbLinks) {
        await this.refurbUnits.markSoldInTx(
          tx,
          refurbUnitId,
          cart.id,
          itemIds.get(variantId)!,
        );
      }
      // empty cart
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      // Phase 10: suppress recovery nudges for this cart — buyer converted.
      await tx.cart.update({
        where: { id: cart.id },
        data: { recoverySuppressedAt: new Date() },
      });
      return created;
    });

    // Phase 3: reservations consumed — release any remaining holds on this cart.
    await this.inventory.releaseCart(cart.id);

    // Phase 11: emit order.placed for analytics + webhooks (`order_paid`
    // still fires later after payment capture).
    this.events.emit('order.placed', { orderId: order.id });

    // Phase 12: score the order. BLOCK refuses; HOLD continues to payment
    // intent creation but marks the order so the post-capture hook will
    // pause it for admin review.
    const buyer = await this.prisma.user.findUnique({ where: { id: userId } });
    const riskResult = await this.risk.assessAndPersist(order.id, {
      userId,
      subtotalMinor,
      totalMinor,
      currency: order.currency,
      shippingCountry: shippingAddress.country,
      billingCountry: billingAddress.country,
      paymentProvider: dto.paymentProvider,
      buyerCreatedAt: buyer?.createdAt ?? new Date(0),
    });
    if (riskResult.decision === 'BLOCK') {
      // Roll back inventory + cancel the order so we don't strand it.
      await this.prisma.$transaction([
        this.prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } }),
        ...order.items.map((i: any) =>
          this.prisma.productVariant.update({
            where: { id: i.variantId },
            data: { inventoryQty: { increment: i.qty } },
          }),
        ),
      ]);
      throw new BadRequestException('We are unable to process this order. Please contact support.');
    }

    // Phase 10: debit wallet for the applied amount + record promo redemptions.
    // These are outside the order $transaction because wallet.applyDelta has
    // its own transaction; a failure here is logged but does not roll back the
    // order — the buyer has already committed, and we'd rather over-credit than
    // half-create state.
    if (walletAppliedMinor > 0) {
      try { await this.wallet.debitForCheckout(userId, walletAppliedMinor, order.id); }
      catch (e) { console.warn(`wallet debit post-order failed: ${(e as Error).message}`); }
    }
    if (promoEval.discountLines.length > 0) {
      await this.promotions.recordRedemptions(order.id, userId, promoEval.discountLines);
    }

    // Phase 5: skip physical shipment for all-digital orders.
    if (!isAllDigitalEarly) {
      // Phase 2: create the Shipment row immediately (status PENDING).
      // The label is purchased after `order.paid` via ShippingService.onOrderPaid().
      const weightGrams = cart.items.reduce((s, i) => s + i.qty * (i.variant.weightGrams || 0), 0) || 500;
      const chosenCarrier = ((shippingCarrier ?? 'mock') as CarrierCode);
      const chosenService = shippingService ?? 'standard';
      await this.shipping.createShipmentForOrder(
        order.id,
        chosenCarrier,
        chosenService,
        weightGrams,
        shippingMinor,
        order.currency,
      );
    }

    // create payment intent via provider abstraction
    const gateway = this.payments.resolve(dto.paymentProvider);

    // Phase 24: resolve saved card before calling the gateway so a missing
    // / mismatched method fails the order before any Stripe round-trip.
    let savedPaymentMethodId: string | undefined;
    let savedPaymentCustomerId: string | undefined;
    if (dto.savedPaymentMethodId) {
      if (gateway.provider !== 'stripe') {
        throw new BadRequestException('Saved cards are only supported with Stripe');
      }
      const method = await this.paymentMethods.defaultFor(userId);
      // Allow either the user's default or a specific id from their list.
      const list = await this.paymentMethods.list(userId);
      const chosen = list.find((m) => m.id === dto.savedPaymentMethodId) ?? null;
      if (!chosen) {
        throw new BadRequestException('Saved payment method not found');
      }
      savedPaymentMethodId = chosen.providerMethodId;
      savedPaymentCustomerId = chosen.providerCustomerId;
      // Silence unused-var lint — `method` is the fallback if we ever want
      // to default-resolve in the future.
      void method;
    }

    let intent: Awaited<ReturnType<typeof gateway.createIntent>>;
    try {
      intent = await gateway.createIntent({
        orderId: order.id,
        amountMinor: order.totalMinor,
        currency: order.currency,
        buyerEmail: buyer?.email ?? 'unknown@onsective.com',
        savedPaymentMethodId,
        savedPaymentCustomerId,
      });
    } catch (e) {
      // Phase 24: surface SCA-required errors so the buyer-web can reflow
      // through Stripe Elements with the existing PaymentIntent's
      // client_secret.
      if (e instanceof PaymentAuthenticationRequiredError) {
        const payment = await this.prisma.payment.create({
          data: {
            id: newId(),
            orderId: order.id,
            provider: gateway.provider,
            providerRef: e.providerRef,
            status: 'INITIATED',
            amountMinor: order.totalMinor,
            currency: order.currency,
            raw: { authenticationRequired: true } as object,
          },
        });
        const dtoOut = this.toDto(order, payment, e.clientSecret);
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          message: 'Card requires additional authentication',
          code: 'PAYMENT_AUTHENTICATION_REQUIRED',
          details: { clientSecret: e.clientSecret, order: dtoOut },
        });
      }
      throw e;
    }

    const payment = await this.prisma.payment.create({
      data: {
        id: newId(),
        orderId: order.id,
        provider: gateway.provider,
        providerRef: intent.providerRef,
        status: intent.capturedOffSession ? 'CAPTURED' : 'INITIATED',
        amountMinor: order.totalMinor,
        currency: order.currency,
        raw: (intent.raw ?? {}) as object,
      },
    });
    // If the off-session capture succeeded synchronously, the webhook may
    // still arrive; the existing handler is idempotent (it only flips if
    // status !== CAPTURED). We mark the order PAID locally now so the
    // buyer sees a confirmed order without waiting on the webhook.
    if (intent.capturedOffSession && order.status !== 'PAID') {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'PAID' },
      });
      this.events.emit('order.paid', { orderId: order.id });
    }

    return this.toDto(order, payment, intent.clientSecret ?? null);
  }

  /**
   * Phase 37: create a single-variant order for a Subscribe & Save run.
   * Self-contained — deliberately does NOT reuse the cart-driven `checkout`
   * path. Charges the buyer's saved card off-session. Returns a result
   * object (never throws on a business failure) so the scheduler can record
   * per-run outcomes; a payment failure cancels the stranded order and
   * restores inventory before returning.
   */
  async createSubscriptionOrder(input: {
    userId: string;
    variantId: string;
    qty: number;
    shippingAddressId: string;
    discountBps: number;
  }): Promise<{ ok: boolean; orderId: string | null; reason?: string }> {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: input.variantId },
      include: { product: { include: { seller: true, category: true } } },
    });
    if (!variant) return { ok: false, orderId: null, reason: 'variant_not_found' };
    const product = variant.product;
    if (product.status !== 'ACTIVE') return { ok: false, orderId: null, reason: 'product_inactive' };
    if (product.isDigital) return { ok: false, orderId: null, reason: 'digital_not_supported' };
    if (variant.inventoryQty < input.qty) return { ok: false, orderId: null, reason: 'out_of_stock' };
    const seller = product.seller;
    if (!seller || seller.status !== 'APPROVED') return { ok: false, orderId: null, reason: 'seller_unavailable' };

    let address;
    try {
      address = await this.users.getAddressOrThrow(input.userId, input.shippingAddressId);
    } catch {
      return { ok: false, orderId: null, reason: 'address_missing' };
    }

    const buyer = await this.prisma.user.findUnique({ where: { id: input.userId } });
    if (!buyer) return { ok: false, orderId: null, reason: 'buyer_missing' };

    const fullSubtotal = variant.priceMinor * input.qty;
    const discountMinor = Math.round((fullSubtotal * input.discountBps) / 10000);
    const netSubtotal = Math.max(0, fullSubtotal - discountMinor);
    const shippingMinor = Number(await this.settings.getInt('platform.flat_shipping.minor'));

    const taxResult = await this.tax.resolveForOrder({
      country: address.country,
      region: address.region,
      postalCode: address.postalCode,
      sellerCountry: seller.originCountry ?? undefined,
      sellerRegion: seller.originRegion ?? undefined,
      currency: product.currency,
      baseMinor: netSubtotal + shippingMinor,
      items: [{
        productId: product.id,
        categorySlug: product.category.slug,
        lineSubtotalMinor: netSubtotal,
        qty: input.qty,
      }],
    });
    const taxMinor = taxResult.totalMinor;
    const totalMinor = netSubtotal + shippingMinor + taxMinor;
    const commissionBps = seller.commissionBps ?? Number(await this.settings.getInt('platform.commission.bps'));
    const commissionMinor = Math.round((netSubtotal * commissionBps) / 10000);

    const orderItemId = newId();
    const order = await this.prisma.$transaction(async (tx) => {
      await tx.productVariant.update({
        where: { id: variant.id },
        data: { inventoryQty: { decrement: input.qty } },
      });
      return tx.order.create({
        data: {
          id: newId(),
          userId: input.userId,
          sellerId: seller.id,
          status: 'PENDING',
          currency: product.currency,
          subtotalMinor: fullSubtotal,
          shippingMinor,
          taxMinor,
          totalMinor,
          commissionMinor,
          taxLines: taxResult.lines as unknown as object,
          promotionLines: (discountMinor > 0
            ? [{ code: 'SUBSCRIBE_SAVE', kind: 'PERCENT', scope: 'SELLER', amountMinor: discountMinor }]
            : []) as unknown as object,
          walletAppliedMinor: 0,
          shippingAddressId: address.id,
          billingAddressId: address.id,
          shippingCarrier: null,
          shippingService: null,
          items: {
            create: [{
              id: orderItemId,
              variantId: variant.id,
              productTitleSnapshot: product.title,
              variantNameSnapshot: variant.name,
              unitPriceMinor: variant.priceMinor,
              qty: input.qty,
              lineSubtotalMinor: fullSubtotal,
              refurbUnitId: null,
              fulfilledFromWarehouseId: null,
              promisedShipBy: null,
              promisedDeliverBy: null,
              slaWindowDays: null,
            }],
          },
        },
        include: { items: true },
      });
    });

    this.events.emit('order.placed', { orderId: order.id });

    const cancelStranded = async () => {
      await this.prisma.$transaction([
        this.prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } }),
        ...order.items.map((i: any) =>
          this.prisma.productVariant.update({
            where: { id: i.variantId },
            data: { inventoryQty: { increment: i.qty } },
          }),
        ),
      ]);
    };

    // Shipment row (label purchased after order.paid by ShippingService).
    const weightGrams = input.qty * (variant.weightGrams || 0) || 500;
    await this.shipping.createShipmentForOrder(
      order.id, 'mock' as CarrierCode, 'standard', weightGrams, shippingMinor, product.currency,
    );

    // Off-session charge against the buyer's default saved card.
    const gateway = this.payments.resolve('stripe');
    const method = await this.paymentMethods.defaultFor(input.userId);
    if (!method) {
      await cancelStranded();
      return { ok: false, orderId: null, reason: 'no_payment_method' };
    }

    let intent: Awaited<ReturnType<typeof gateway.createIntent>>;
    try {
      intent = await gateway.createIntent({
        orderId: order.id,
        amountMinor: totalMinor,
        currency: product.currency,
        buyerEmail: buyer.email,
        savedPaymentMethodId: method.providerMethodId,
        savedPaymentCustomerId: method.providerCustomerId,
      });
    } catch (e) {
      await cancelStranded();
      const reason = e instanceof PaymentAuthenticationRequiredError
        ? 'authentication_required'
        : 'payment_failed';
      return { ok: false, orderId: null, reason };
    }

    await this.prisma.payment.create({
      data: {
        id: newId(),
        orderId: order.id,
        provider: gateway.provider,
        providerRef: intent.providerRef,
        status: intent.capturedOffSession ? 'CAPTURED' : 'INITIATED',
        amountMinor: totalMinor,
        currency: product.currency,
        raw: (intent.raw ?? {}) as object,
      },
    });

    if (!intent.capturedOffSession) {
      // Off-session must capture synchronously; an unconfirmed intent means
      // the card needs interaction we can't drive here. Treat as a failure.
      await cancelStranded();
      return { ok: false, orderId: null, reason: 'payment_not_captured' };
    }

    await this.prisma.order.update({ where: { id: order.id }, data: { status: 'PAID' } });
    this.events.emit('order.paid', { orderId: order.id });
    return { ok: true, orderId: order.id };
  }

  async listMine(userId: string): Promise<OrderDto[]> {
    const orders = await this.prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        items: true,
        shippingAddress: true,
        billingAddress: true,
        seller: true,
        payment: true,
        shipment: true,
      },
    });
    return orders.map((o) => this.toDto(o, o.payment, null));
  }

  async get(userId: string, role: string, orderId: string): Promise<OrderDto> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        shippingAddress: true,
        billingAddress: true,
        seller: { include: { user: true } },
        payment: true,
        shipment: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    const isBuyer = order.userId === userId;
    const isSellerOwner = order.seller.userId === userId;
    const isAdmin = role === 'ADMIN';
    if (!isBuyer && !isSellerOwner && !isAdmin) throw new ForbiddenException('Not your order');
    return this.toDto(order, order.payment, null);
  }

  private toDto(order: any, payment: any, clientSecret: string | null): OrderDto {
    return {
      id: order.id,
      status: order.status as OrderStatus,
      currency: order.currency as CurrencyCode,
      subtotalMinor: order.subtotalMinor,
      shippingMinor: order.shippingMinor,
      taxMinor: order.taxMinor,
      totalMinor: order.totalMinor,
      commissionMinor: order.commissionMinor,
      walletAppliedMinor: order.walletAppliedMinor ?? 0,
      promotionLines: Array.isArray(order.promotionLines) ? order.promotionLines : [],
      shippingAddress: addressToDto(order.shippingAddress),
      billingAddress: addressToDto(order.billingAddress),
      items: (order.items ?? []).map((i: any) => ({
        id: i.id,
        variantId: i.variantId,
        productTitleSnapshot: i.productTitleSnapshot,
        variantNameSnapshot: i.variantNameSnapshot,
        unitPriceMinor: i.unitPriceMinor,
        qty: i.qty,
        lineSubtotalMinor: i.lineSubtotalMinor,
      })),
      sellerId: order.sellerId,
      sellerName: order.seller?.displayName ?? '',
      createdAt: order.createdAt.toISOString(),
      payment: {
        provider: (payment?.provider ?? 'mock') as PaymentProvider,
        status: (payment?.status ?? 'INITIATED') as PaymentStatus,
        clientSecret,
        providerRef: payment?.providerRef ?? null,
      },
      shipment: order.shipment
        ? {
            id: order.shipment.id,
            carrierCode: order.shipment.carrierCode,
            serviceLevel: order.shipment.serviceLevel,
            status: order.shipment.status,
            trackingNumber: order.shipment.trackingNumber ?? null,
            publicToken: order.shipment.publicToken,
          }
        : null,
    };
  }
}
