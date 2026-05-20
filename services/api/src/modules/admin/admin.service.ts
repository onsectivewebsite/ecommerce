import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { AuditService } from '../audit/audit.service';
import type { SellerStatus } from '@onsective/shared-types';

interface ActorMeta { userId: string; ip?: string; userAgent?: string }

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async listSellers(status?: SellerStatus) {
    const sellers = await this.prisma.seller.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      include: { user: true },
    });
    return sellers.map((s) => ({
      id: s.id,
      storeName: s.storeName,
      displayName: s.displayName,
      status: s.status,
      ownerEmail: s.user.email,
      ownerName: `${s.user.firstName} ${s.user.lastName}`.trim(),
      commissionBps: s.commissionBps,
      createdAt: s.createdAt.toISOString(),
    }));
  }

  async approveSeller(id: string, commissionBps: number | undefined, actor: ActorMeta) {
    const before = await this.prisma.seller.findUnique({ where: { id }, include: { user: true } });
    if (!before) throw new NotFoundException('Seller not found');
    const updated = await this.prisma.seller.update({
      where: { id },
      data: { status: 'APPROVED', commissionBps: commissionBps ?? before.commissionBps },
      include: { user: true },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'seller.approve',
      entityType: 'Seller',
      entityId: id,
      before: { status: before.status, commissionBps: before.commissionBps },
      after: { status: updated.status, commissionBps: updated.commissionBps },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return this.toSellerDto(updated);
  }

  async rejectSeller(id: string, reason: string | undefined, actor: ActorMeta) {
    const before = await this.prisma.seller.findUnique({ where: { id }, include: { user: true } });
    if (!before) throw new NotFoundException('Seller not found');
    const updated = await this.prisma.seller.update({
      where: { id },
      data: { status: 'REJECTED', rejectionReason: reason },
      include: { user: true },
    });
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'seller.reject',
      entityType: 'Seller',
      entityId: id,
      before: { status: before.status },
      after: { status: updated.status, reason },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return this.toSellerDto(updated);
  }

  async listOrders() {
    const orders = await this.prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { items: true, shippingAddress: true, billingAddress: true, seller: true, payment: true, user: true },
    });
    return orders.map((o) => ({
      id: o.id,
      status: o.status,
      currency: o.currency,
      subtotalMinor: o.subtotalMinor,
      shippingMinor: o.shippingMinor,
      taxMinor: o.taxMinor,
      totalMinor: o.totalMinor,
      commissionMinor: o.commissionMinor,
      sellerId: o.sellerId,
      sellerName: o.seller.displayName,
      buyerEmail: o.user.email,
      createdAt: o.createdAt.toISOString(),
      paymentStatus: o.payment?.status ?? 'INITIATED',
      paymentProvider: o.payment?.provider ?? 'mock',
    }));
  }

  listSettings() {
    return this.settings.list();
  }

  async upsertSetting(key: string, value: string, description: string | undefined, actor: ActorMeta) {
    const before = await this.prisma.adminSetting.findUnique({ where: { key } });
    const updated = await this.settings.upsert(key, value, description);
    await this.audit.record({
      actorUserId: actor.userId,
      action: 'settings.upsert',
      entityType: 'AdminSetting',
      entityId: key,
      before: before ? { value: before.value, description: before.description } : null,
      after: { value: updated.value, description: updated.description },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return updated;
  }

  async listAuditLog(filter: { actorUserId?: string; entityType?: string; entityId?: string }) {
    return this.audit.list(filter);
  }

  private toSellerDto(s: any) {
    return {
      id: s.id,
      storeName: s.storeName,
      displayName: s.displayName,
      status: s.status,
      ownerEmail: s.user.email,
      ownerName: `${s.user.firstName} ${s.user.lastName}`.trim(),
      commissionBps: s.commissionBps,
      createdAt: s.createdAt.toISOString(),
    };
  }
}
