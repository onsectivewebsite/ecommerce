import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';

export interface AuditRecord {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(rec: AuditRecord) {
    await this.prisma.auditLogEntry.create({
      data: {
        id: newId(),
        actorUserId: rec.actorUserId ?? null,
        action: rec.action,
        entityType: rec.entityType,
        entityId: rec.entityId ?? null,
        before: (rec.before ?? {}) as object,
        after: (rec.after ?? {}) as object,
        ip: rec.ip ?? null,
        userAgent: rec.userAgent ?? null,
      },
    });
  }

  async list(filters: { actorUserId?: string; entityType?: string; entityId?: string; limit?: number } = {}) {
    return this.prisma.auditLogEntry.findMany({
      where: {
        actorUserId: filters.actorUserId,
        entityType: filters.entityType,
        entityId: filters.entityId,
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, filters.limit ?? 200),
    });
  }
}
