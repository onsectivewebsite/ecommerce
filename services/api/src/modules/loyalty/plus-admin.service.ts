import { Injectable } from '@nestjs/common';
import { MembershipBillingEventKind, MembershipPlan, MembershipStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const ONE_DAY = 24 * 60 * 60 * 1000;

export interface PlusStats {
  activeCount: number;
  pausedCount: number;
  /** Sum of monthly-equivalent revenue across ACTIVE rows (minor units). */
  mrrMinor: number;
  newLast30dByPlan: Record<MembershipPlan, number>;
  churnedLast30dByPlan: Record<MembershipPlan, number>;
  asOf: string;
}

@Injectable()
export class PlusAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async stats(): Promise<PlusStats> {
    const now = new Date();
    const since30d = new Date(now.getTime() - 30 * ONE_DAY);

    const [active, paused] = await Promise.all([
      this.prisma.plusMembership.findMany({
        where: {
          status: MembershipStatus.ACTIVE,
          expiresAt: { gt: now },
        },
        select: { plan: true, pricePaidMinor: true },
      }),
      this.prisma.plusMembership.count({
        where: { status: MembershipStatus.PAUSED },
      }),
    ]);

    const mrrMinor = active.reduce((sum, m) => {
      const monthly = m.plan === MembershipPlan.PLUS_ANNUAL
        ? Math.round(m.pricePaidMinor / 12)
        : m.pricePaidMinor;
      return sum + monthly;
    }, 0);

    const [newRows, churnedRows] = await Promise.all([
      this.prisma.plusMembership.groupBy({
        by: ['plan'],
        where: { startedAt: { gt: since30d } },
        _count: { _all: true },
      }),
      this.prisma.plusMembership.groupBy({
        by: ['plan'],
        where: {
          status: { in: [MembershipStatus.EXPIRED, MembershipStatus.CANCELLED] },
          cancelledAt: { gt: since30d },
        },
        _count: { _all: true },
      }),
    ]);

    const blank: Record<MembershipPlan, number> = {
      PLUS_ANNUAL: 0,
      PLUS_MONTHLY: 0,
    };
    const newByPlan: Record<MembershipPlan, number> = { ...blank };
    for (const r of newRows) newByPlan[r.plan] = r._count._all;
    const churnedByPlan: Record<MembershipPlan, number> = { ...blank };
    for (const r of churnedRows) churnedByPlan[r.plan] = r._count._all;

    return {
      activeCount: active.length,
      pausedCount: paused,
      mrrMinor,
      newLast30dByPlan: newByPlan,
      churnedLast30dByPlan: churnedByPlan,
      asOf: now.toISOString(),
    };
  }

  async recentBillingEvents(limit = 50, kind?: MembershipBillingEventKind) {
    const rows = await this.prisma.membershipBillingEvent.findMany({
      where: kind ? { kind } : {},
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, Math.max(1, limit)),
      include: {
        membership: {
          select: {
            id: true,
            plan: true,
            user: { select: { id: true, email: true, firstName: true, lastName: true } },
          },
        },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      amountMinor: r.amountMinor,
      currency: r.currency,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
      membership: {
        id: r.membership.id,
        plan: r.membership.plan,
        userEmail: r.membership.user.email,
        userName: `${r.membership.user.firstName} ${r.membership.user.lastName}`.trim(),
      },
    }));
  }
}
