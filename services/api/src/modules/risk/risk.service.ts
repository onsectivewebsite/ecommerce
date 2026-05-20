import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

interface ActorMeta { userId: string; ip?: string; userAgent?: string }

@Injectable()
export class RiskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  // ---------- admin review queue ----------

  async openHolds() {
    return this.prisma.orderHold.findMany({
      where: { status: 'OPEN' },
      orderBy: { createdAt: 'asc' },
      include: {
        order: {
          select: {
            id: true, userId: true, sellerId: true, totalMinor: true, currency: true, status: true,
            riskAssessment: { include: { hits: true } },
          },
        },
      },
      take: 200,
    });
  }

  async getOrderAssessment(orderId: string) {
    const assessment = await this.prisma.riskAssessment.findUnique({
      where: { orderId },
      include: { hits: true, order: { select: { id: true, userId: true, totalMinor: true, currency: true, status: true } } },
    });
    if (!assessment) throw new NotFoundException('No risk assessment for order');
    return assessment;
  }

  async release(orderId: string, note: string, actor: ActorMeta) {
    const hold = await this.prisma.orderHold.findUnique({ where: { orderId } });
    if (!hold) throw new NotFoundException('Hold not found');
    if (hold.status !== 'OPEN') throw new ForbiddenException('Hold is not open');
    await this.prisma.orderHold.update({
      where: { id: hold.id },
      data: { status: 'RELEASED', reviewedBy: actor.userId, reviewedAt: new Date(), reviewNote: note },
    });
    // If the order has already been paid, re-emit order.paid so shipping +
    // notifications resume — they skipped the first emission because the
    // hold was open.
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (order?.status === 'PAID') {
      this.events.emit('order.paid', { orderId });
    }
    await this.audit.record({
      actorUserId: actor.userId, action: 'risk.release', entityType: 'Order', entityId: orderId,
      after: { note }, ip: actor.ip, userAgent: actor.userAgent,
    });
    return { ok: true };
  }

  async cancel(orderId: string, note: string, actor: ActorMeta) {
    const hold = await this.prisma.orderHold.findUnique({ where: { orderId } });
    if (!hold) throw new NotFoundException('Hold not found');
    if (hold.status !== 'OPEN') throw new ForbiddenException('Hold is not open');
    await this.prisma.$transaction([
      this.prisma.orderHold.update({
        where: { id: hold.id },
        data: { status: 'CANCELLED', reviewedBy: actor.userId, reviewedAt: new Date(), reviewNote: note },
      }),
      this.prisma.order.update({
        where: { id: orderId },
        data: { status: 'CANCELLED' },
      }),
    ]);
    await this.audit.record({
      actorUserId: actor.userId, action: 'risk.cancel', entityType: 'Order', entityId: orderId,
      after: { note }, ip: actor.ip, userAgent: actor.userAgent,
    });
    return { ok: true };
  }
}
