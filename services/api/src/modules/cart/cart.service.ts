import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { ComplianceGateService } from '../compliance/compliance-gate.service';
import { newId } from '../../common/id';
import type { CartDto, CurrencyCode } from '@onsective/shared-types';

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly compliance: ComplianceGateService,
    private readonly events: EventEmitter2,
  ) {}

  async getOrCreate(userId: string): Promise<CartDto> {
    let cart = await this.prisma.cart.findUnique({
      where: { userId },
      include: this.includeFull(),
    });
    if (!cart) {
      cart = await this.prisma.cart.create({
        data: { id: newId(), userId, currency: 'USD' },
        include: this.includeFull(),
      });
    }
    return this.toDto(cart);
  }

  async addItem(userId: string, variantId: string, qty: number): Promise<CartDto> {
    if (qty < 1) throw new BadRequestException('qty must be >= 1');
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      include: { product: true },
    });
    if (!variant || variant.product.status !== 'ACTIVE') {
      throw new NotFoundException('Variant not available');
    }
    // Compliance: age-gate and seller-doc checks before adding any qty.
    await this.compliance.gateCartAdd(userId, variant.productId);

    const cart = await this.ensureCart(userId, variant.product.currency);
    if (cart.currency !== variant.product.currency) {
      throw new BadRequestException('Cart currency mismatch');
    }
    const existing = await this.prisma.cartItem.findUnique({
      where: { cartId_variantId: { cartId: cart.id, variantId } },
    });
    const newQty = (existing?.qty ?? 0) + qty;
    // Reserve first — throws BadRequest if insufficient effective stock.
    await this.inventory.reserve(cart.id, variantId, newQty);
    if (existing) {
      await this.prisma.cartItem.update({
        where: { id: existing.id },
        data: { qty: newQty, unitPriceMinor: variant.priceMinor },
      });
    } else {
      await this.prisma.cartItem.create({
        data: {
          id: newId(),
          cartId: cart.id,
          variantId,
          qty,
          unitPriceMinor: variant.priceMinor,
        },
      });
    }
    // Phase 11: emit for seller analytics. Fire-and-forget.
    this.events.emit('cart.item.added', {
      variantId,
      qty,
      userId,
      unitPriceMinor: variant.priceMinor,
      currency: variant.product.currency,
    });
    return this.getOrCreate(userId);
  }

  async updateItem(userId: string, itemId: string, qty: number): Promise<CartDto> {
    const cart = await this.prisma.cart.findUnique({ where: { userId } });
    if (!cart) throw new NotFoundException('Cart not found');
    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cartId: cart.id },
      include: { variant: true },
    });
    if (!item) throw new NotFoundException('Cart item not found');
    if (qty === 0) {
      await this.prisma.cartItem.delete({ where: { id: item.id } });
      await this.inventory.release(cart.id, item.variantId);
    } else {
      await this.inventory.reserve(cart.id, item.variantId, qty);
      await this.prisma.cartItem.update({ where: { id: item.id }, data: { qty } });
    }
    return this.getOrCreate(userId);
  }

  async removeItem(userId: string, itemId: string): Promise<CartDto> {
    return this.updateItem(userId, itemId, 0);
  }

  private async ensureCart(userId: string, currency: string) {
    const existing = await this.prisma.cart.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.cart.create({ data: { id: newId(), userId, currency } });
  }

  private includeFull() {
    return {
      items: {
        include: {
          variant: {
            include: {
              product: { include: { media: { orderBy: { position: 'asc' as const }, take: 1 } } },
            },
          },
        },
        orderBy: { createdAt: 'asc' as const },
      },
    };
  }

  private toDto(cart: any): CartDto {
    const items = (cart.items ?? []).map((i: any) => ({
      id: i.id,
      variantId: i.variantId,
      productSlug: i.variant.product.slug,
      productTitle: i.variant.product.title,
      variantName: i.variant.name,
      unitPriceMinor: i.unitPriceMinor,
      qty: i.qty,
      lineSubtotalMinor: i.unitPriceMinor * i.qty,
      imageUrl: i.variant.product.media?.[0]?.url ?? null,
    }));
    const subtotalMinor = items.reduce((s: number, x: { lineSubtotalMinor: number }) => s + x.lineSubtotalMinor, 0);
    const itemCount = items.reduce((s: number, x: { qty: number }) => s + x.qty, 0);
    return {
      id: cart.id,
      currency: cart.currency as CurrencyCode,
      items,
      subtotalMinor,
      itemCount,
    };
  }
}
