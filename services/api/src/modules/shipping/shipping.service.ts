import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OnEvent } from '@nestjs/event-emitter';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { SettingsService } from '../settings/settings.service';
import { newId } from '../../common/id';
import { CarrierRegistry } from './carriers/registry';
import type {
  CarrierCode,
  NormalizedEvent,
  PurchaseInput,
  QuoteInput,
  QuoteResult,
  ShipAddress,
} from './carriers/types';
import type { ShipmentStatus, ShipmentEventSource } from '@prisma/client';

interface AggregatedShipInput {
  origin: ShipAddress;
  destination: ShipAddress;
  weightGrams: number;
  currency: string;
  declaredValueMinor: number;
  sellerId: string;
}

@Injectable()
export class ShippingService {
  private readonly logger = new Logger(ShippingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: CarrierRegistry,
    private readonly media: MediaService,
    private readonly events: EventEmitter2,
    private readonly settings: SettingsService,
  ) {}

  // --------- quote ---------

  async quoteForBuyerCart(userId: string, shippingAddressId: string): Promise<{
    options: QuoteResult[];
    flat: { amountMinor: number; currency: string };
  }> {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      include: { items: { include: { variant: { include: { product: { include: { seller: true } } } } } } },
    });
    if (!cart || cart.items.length === 0) throw new BadRequestException('Cart empty');
    const sellerIds = new Set(cart.items.map((i) => i.variant.product.sellerId));
    if (sellerIds.size > 1) throw new BadRequestException('Phase 1+2 supports single-seller checkout');
    const sellerId = [...sellerIds][0]!;

    const address = await this.prisma.address.findFirst({ where: { id: shippingAddressId, userId } });
    if (!address) throw new NotFoundException('Address not found');

    const seller = await this.prisma.seller.findUnique({ where: { id: sellerId } });
    if (!seller) throw new BadRequestException('Seller missing');

    const weightGrams = cart.items.reduce((s, i) => s + i.qty * (i.variant.weightGrams || 0), 0) || 500;
    const declaredValueMinor = cart.items.reduce((s, i) => s + i.unitPriceMinor * i.qty, 0);

    const origin = this.originAddressForSeller(seller);
    const destination: ShipAddress = {
      fullName: address.fullName,
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      region: address.region,
      postalCode: address.postalCode,
      country: address.country,
      phone: address.phone,
    };

    const ruleCarriers = await this.allowedCarriersForSeller(seller.id, address.country);
    const flat = await this.flatRateFor(sellerId, address.country, declaredValueMinor, cart.currency);

    const options = await this.collectQuotes({
      origin,
      destination,
      weightGrams,
      currency: cart.currency,
      declaredValueMinor,
      sellerId,
    }, ruleCarriers);

    return { options, flat };
  }

  private async collectQuotes(agg: AggregatedShipInput, carrierCodes: CarrierCode[]): Promise<QuoteResult[]> {
    const adapters = this.registry.forCodes(carrierCodes);
    if (adapters.length === 0) return [];
    const results = await Promise.allSettled(adapters.map((a) =>
      a.quote({
        origin: agg.origin,
        destination: agg.destination,
        weightGrams: agg.weightGrams,
        declaredValueMinor: agg.declaredValueMinor,
        currency: agg.currency,
      }),
    ));
    return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  }

  async allowedCarriersForSeller(sellerId: string, destinationCountry: string): Promise<CarrierCode[]> {
    const rule = await this.bestRule(sellerId, destinationCountry);
    const configs = await this.prisma.carrierConfig.findMany({
      where: { sellerId, enabled: true, carrier: { globallyEnabled: true } },
      include: { carrier: true },
    });
    const whitelist = rule?.carrierCodeWhitelist?.length ? new Set(rule.carrierCodeWhitelist) : null;
    return configs
      .map((c) => c.carrierCode as CarrierCode)
      .filter((c) => !whitelist || whitelist.has(c));
  }

  private async bestRule(sellerId: string, destinationCountry: string) {
    const candidates = await this.prisma.shippingRule.findMany({
      where: { sellerId, enabled: true },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
    return candidates.find((r) =>
      r.destinationCountries.length === 0 || r.destinationCountries.includes(destinationCountry.toUpperCase()),
    );
  }

  private async flatRateFor(sellerId: string, destinationCountry: string, declaredValueMinor: number, currency: string) {
    const rule = await this.bestRule(sellerId, destinationCountry);
    if (!rule) {
      const flat = await this.settings.getInt('platform.flat_shipping.minor');
      return { amountMinor: flat, currency };
    }
    if (rule.freeAboveMinor != null && declaredValueMinor >= rule.freeAboveMinor) {
      return { amountMinor: 0, currency: rule.currency || currency };
    }
    if (rule.flatRateMinor != null) {
      return { amountMinor: rule.flatRateMinor, currency: rule.currency || currency };
    }
    return { amountMinor: 0, currency: rule.currency || currency };
  }

  // --------- create + purchase ---------

  async createShipmentForOrder(orderId: string, carrierCode: CarrierCode, serviceLevel: string, weightGrams: number, amountMinor: number, currency: string) {
    const token = randomBytes(32).toString('base64url');
    return this.prisma.shipment.create({
      data: {
        id: newId(),
        orderId,
        carrierCode,
        serviceLevel,
        status: 'PENDING',
        weightGrams,
        costMinor: amountMinor,
        currency,
        publicToken: token,
      },
    });
  }

  /**
   * Phase 9: produce a return-leg label for an approved Return. We don't write a
   * second Shipment row because the outbound Shipment already owns the `orderId
   * @unique` slot — `Return` stores carrier metadata inline.
   *
   * Caller (`ReturnsService.approve`) persists the returned values onto the
   * Return row, then surfaces the signed label URL to the buyer.
   */
  async purchaseReturnLabel(orderId: string, weightGramsHint = 0): Promise<{
    carrierCode: CarrierCode;
    trackingNumber: string | null;
    labelObjectKey: string;
    publicToken: string;
  }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { shipment: true, shippingAddress: true, seller: true },
    });
    if (!order) throw new BadRequestException('Order not found');
    if (!order.shipment) throw new BadRequestException('Original shipment missing — cannot generate return label');

    const carrierCode = order.shipment.carrierCode as CarrierCode;
    const adapter = this.registry.byCode(carrierCode);

    // Swap: buyer's shipping address → seller's origin.
    const buyerAddr: ShipAddress = {
      fullName: order.shippingAddress.fullName,
      line1: order.shippingAddress.line1,
      line2: order.shippingAddress.line2,
      city: order.shippingAddress.city,
      region: order.shippingAddress.region,
      postalCode: order.shippingAddress.postalCode,
      country: order.shippingAddress.country,
      phone: order.shippingAddress.phone,
    };
    const sellerOrigin = this.originAddressForSeller(order.seller);

    const input: PurchaseInput = {
      origin: buyerAddr,
      destination: sellerOrigin,
      weightGrams: weightGramsHint || order.shipment.weightGrams || 500,
      currency: order.currency,
      declaredValueMinor: order.subtotalMinor,
      orderId: order.id,
      shipmentId: `return:${order.id}`,
      serviceLevel: order.shipment.serviceLevel,
      reference: `RETURN-${order.id}`,
    };

    const label = await adapter.purchaseLabel(input);
    const key = `labels/return-${order.id}-${Date.now()}.pdf`;
    await this.media.putObject(key, label.labelPdf, 'application/pdf');

    return {
      carrierCode,
      trackingNumber: label.trackingNumber,
      labelObjectKey: key,
      publicToken: randomBytes(32).toString('base64url'),
    };
  }

  /** Presigned GET so the buyer can download the return-label PDF. */
  presignLabel(key: string, ttlSec = 600): string {
    return this.media.presignGetUrl(key, ttlSec);
  }

  @OnEvent('order.paid')
  async onOrderPaid(payload: { orderId: string }) {
    // Phase 12: do not purchase a label if the order is on hold for risk
    // review. The admin's release action will re-fire `order.paid` so we
    // pick up the label purchase then.
    const hold = await this.prisma.orderHold.findUnique({ where: { orderId: payload.orderId } });
    if (hold && hold.status === 'OPEN') {
      this.logger.log(`Skipping label purchase for held order ${payload.orderId}`);
      return;
    }
    try {
      await this.purchaseLabelForOrder(payload.orderId);
    } catch (e) {
      this.logger.error(`Label purchase failed for order ${payload.orderId}: ${(e as Error).message}`);
    }
  }

  async purchaseLabelForOrder(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        shipment: true,
        items: { include: { variant: { include: { product: true } } } },
        shippingAddress: true,
        seller: true,
      },
    });
    if (!order) return;
    if (!order.shipment) {
      // All-digital orders intentionally skip shipment creation in OrdersService.
      // No-op silently to keep logs clean.
      return;
    }
    if (order.shipment.status !== 'PENDING') return; // idempotent
    const adapter = this.registry.byCode(order.shipment.carrierCode as CarrierCode);
    const origin = this.originAddressForSeller(order.seller);
    const destination: ShipAddress = {
      fullName: order.shippingAddress.fullName,
      line1: order.shippingAddress.line1,
      line2: order.shippingAddress.line2,
      city: order.shippingAddress.city,
      region: order.shippingAddress.region,
      postalCode: order.shippingAddress.postalCode,
      country: order.shippingAddress.country,
      phone: order.shippingAddress.phone,
    };

    // Phase 5: build customs lines from product HSN metadata. The adapter / label
    // generator only prints the customs block when origin.country != destination.country.
    const customs = order.items.map((i) => ({
      description: i.productTitleSnapshot,
      hsnCode: i.variant.product.hsnCode ?? null,
      tariffCountry: i.variant.product.tariffCountry ?? null,
      qty: i.qty,
      unitValueMinor: i.unitPriceMinor,
      currency: order.currency,
    }));

    const input: PurchaseInput = {
      origin,
      destination,
      weightGrams: order.shipment.weightGrams || 500,
      currency: order.currency,
      declaredValueMinor: order.subtotalMinor,
      orderId: order.id,
      shipmentId: order.shipment.id,
      serviceLevel: order.shipment.serviceLevel,
      reference: order.id,
      customs,
    };
    const label = await adapter.purchaseLabel(input);
    const key = `labels/${order.shipment.id}.pdf`;
    await this.media.putObject(key, label.labelPdf, 'application/pdf');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.shipment.update({
        where: { id: order.shipment.id },
        data: {
          status: 'LABEL_PURCHASED',
          trackingNumber: label.trackingNumber,
          labelObjectKey: key,
          purchasedAt: now,
        },
      }),
      this.prisma.shipmentEvent.create({
        data: {
          id: newId(),
          shipmentId: order.shipment.id,
          code: 'label_created',
          label: 'Shipping label purchased',
          occurredAt: now,
          source: 'SYSTEM',
          raw: { trackingNumber: label.trackingNumber } as object,
        },
      }),
    ]);
    this.events.emit('shipment.updated', { shipmentId: order.shipment.id });
  }

  // --------- partner + tracking ---------

  async listPendingShipments(): Promise<any[]> {
    return this.prisma.shipment.findMany({
      where: { status: { in: ['LABEL_PURCHASED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'] } },
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: { order: { include: { shippingAddress: true, seller: true } } },
    });
  }

  async getByPublicToken(token: string) {
    const s = await this.prisma.shipment.findUnique({
      where: { publicToken: token },
      include: { events: { orderBy: { occurredAt: 'asc' } }, order: { include: { shippingAddress: true, seller: true } } },
    });
    if (!s) throw new NotFoundException('Tracking not found');
    return this.publicView(s);
  }

  async getById(id: string, user: { userId: string; role: string }) {
    const s = await this.prisma.shipment.findUnique({
      where: { id },
      include: { events: { orderBy: { occurredAt: 'asc' } }, order: { include: { shippingAddress: true, seller: true } } },
    });
    if (!s) throw new NotFoundException('Shipment not found');
    const isBuyer = s.order.userId === user.userId;
    const isSeller = s.order.seller.userId === user.userId;
    const isAdmin = user.role === 'ADMIN';
    const isShipper = user.role === 'SHIPPER';
    if (!isBuyer && !isSeller && !isAdmin && !isShipper) throw new ForbiddenException('Not your shipment');
    return s;
  }

  async getLabelDownloadUrl(id: string, user: { userId: string; role: string }): Promise<string> {
    const s = await this.getById(id, user);
    if (!s.labelObjectKey) throw new NotFoundException('Label not generated yet');
    return this.media.presignGetUrl(s.labelObjectKey, 300);
  }

  async recordMilestone(shipmentId: string, milestone: {
    code: 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception';
    label: string;
    description?: string;
    locationCity?: string;
    locationCountry?: string;
  }, source: ShipmentEventSource = 'PARTNER') {
    const status = this.codeToStatus(milestone.code);
    const now = new Date();
    const [, , updated] = await this.prisma.$transaction([
      this.prisma.shipmentEvent.create({
        data: {
          id: newId(),
          shipmentId,
          code: milestone.code,
          label: milestone.label,
          description: milestone.description,
          locationCity: milestone.locationCity,
          locationCountry: milestone.locationCountry,
          occurredAt: now,
          source,
          raw: milestone as object,
        },
      }),
      this.prisma.shipment.update({
        where: { id: shipmentId },
        data: {
          status,
          pickedUpAt: milestone.code === 'picked_up' ? now : undefined,
          deliveredAt: milestone.code === 'delivered' ? now : undefined,
        },
      }),
      this.prisma.shipment.findUniqueOrThrow({
        where: { id: shipmentId },
        include: { events: { orderBy: { occurredAt: 'asc' } } },
      }),
    ]);
    if (milestone.code === 'delivered') {
      await this.prisma.order.update({
        where: { id: updated.orderId },
        data: { status: 'DELIVERED' },
      });
    } else if (milestone.code === 'in_transit' || milestone.code === 'out_for_delivery' || milestone.code === 'picked_up') {
      await this.prisma.order.update({
        where: { id: updated.orderId },
        data: { status: 'SHIPPED' },
      });
    }
    this.events.emit('shipment.updated', { shipmentId });
    return updated;
  }

  async ingestNormalizedEvents(shipmentId: string, events: NormalizedEvent[]) {
    for (const e of events) {
      await this.prisma.shipmentEvent.create({
        data: {
          id: newId(),
          shipmentId,
          code: e.code,
          label: e.label,
          description: e.description,
          locationCity: e.locationCity,
          locationCountry: e.locationCountry,
          occurredAt: e.occurredAt,
          source: 'CARRIER',
          raw: (e.raw as object) ?? {},
        },
      });
    }
    if (events.length > 0) this.events.emit('shipment.updated', { shipmentId });
  }

  // --------- helpers ---------

  private codeToStatus(code: NormalizedEvent['code']): ShipmentStatus {
    switch (code) {
      case 'picked_up': return 'PICKED_UP';
      case 'in_transit': return 'IN_TRANSIT';
      case 'out_for_delivery': return 'OUT_FOR_DELIVERY';
      case 'delivered': return 'DELIVERED';
      case 'exception': return 'EXCEPTION';
      case 'cancelled': return 'CANCELLED';
      case 'label_created':
      default: return 'LABEL_PURCHASED';
    }
  }

  private originAddressForSeller(seller: any): ShipAddress {
    if (seller.originLine1) {
      return {
        fullName: seller.originName ?? seller.displayName,
        line1: seller.originLine1,
        line2: seller.originLine2,
        city: seller.originCity,
        region: seller.originRegion,
        postalCode: seller.originPostal,
        country: seller.originCountry,
        phone: seller.originPhone,
      };
    }
    // platform-level fallback so dev never blocks on missing seller origin
    return {
      fullName: 'Onsective Fulfillment',
      line1: '1 Market Street',
      city: 'San Francisco',
      region: 'CA',
      postalCode: '94105',
      country: 'US',
      phone: '+1-415-000-0000',
    };
  }

  private publicView(s: any) {
    return {
      id: s.id,
      orderId: s.orderId,
      carrierCode: s.carrierCode,
      serviceLevel: s.serviceLevel,
      status: s.status,
      trackingNumber: s.trackingNumber,
      deliveredAt: s.deliveredAt,
      destinationCity: s.order.shippingAddress.city,
      destinationCountry: s.order.shippingAddress.country,
      sellerName: s.order.seller.displayName,
      events: s.events.map((e: any) => ({
        code: e.code,
        label: e.label,
        description: e.description,
        locationCity: e.locationCity,
        locationCountry: e.locationCountry,
        occurredAt: e.occurredAt,
      })),
    };
  }
}
