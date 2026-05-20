import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { AuditService } from '../audit/audit.service';
import type { WarehouseStatus } from '@prisma/client';

interface ActorMeta { userId: string; ip?: string; userAgent?: string }

export interface CreateWarehouseInput {
  code: string;
  displayName: string;
  line1: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  priority?: number;
  zones?: Array<{ country: string; regions?: string[] }>;
}

@Injectable()
export class WarehousesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.warehouse.findMany({
      orderBy: [{ status: 'asc' }, { priority: 'asc' }, { displayName: 'asc' }],
      include: { zones: true, _count: { select: { stocks: true } } },
    });
  }

  async create(input: CreateWarehouseInput, actor: ActorMeta) {
    const existing = await this.prisma.warehouse.findUnique({ where: { code: input.code.toUpperCase() } });
    if (existing) throw new ConflictException('Warehouse code already exists');
    const created = await this.prisma.warehouse.create({
      data: {
        id: newId(),
        code: input.code.toUpperCase(),
        displayName: input.displayName,
        line1: input.line1,
        city: input.city,
        region: input.region,
        postalCode: input.postalCode,
        country: input.country.toUpperCase(),
        priority: input.priority ?? 100,
        zones: input.zones && input.zones.length > 0 ? {
          create: input.zones.map((z) => ({
            id: newId(),
            country: z.country.toUpperCase(),
            regions: (z.regions ?? []).map((r) => r.toUpperCase()),
          })),
        } : undefined,
      },
      include: { zones: true },
    });
    await this.audit.record({
      actorUserId: actor.userId, action: 'warehouse.create', entityType: 'Warehouse', entityId: created.id,
      after: { code: created.code, displayName: created.displayName },
      ip: actor.ip, userAgent: actor.userAgent,
    });
    return created;
  }

  async update(id: string, patch: Partial<{ displayName: string; status: WarehouseStatus; priority: number }>, actor: ActorMeta) {
    const wh = await this.prisma.warehouse.findUnique({ where: { id } });
    if (!wh) throw new NotFoundException('Warehouse not found');
    const updated = await this.prisma.warehouse.update({
      where: { id },
      data: patch,
    });
    await this.audit.record({
      actorUserId: actor.userId, action: 'warehouse.update', entityType: 'Warehouse', entityId: id,
      before: wh, after: updated, ip: actor.ip, userAgent: actor.userAgent,
    });
    return updated;
  }

  async addZone(warehouseId: string, country: string, regions: string[], actor: ActorMeta) {
    const created = await this.prisma.warehouseZone.create({
      data: {
        id: newId(),
        warehouseId,
        country: country.toUpperCase(),
        regions: regions.map((r) => r.toUpperCase()),
      },
    });
    await this.audit.record({
      actorUserId: actor.userId, action: 'warehouse.zone.add', entityType: 'WarehouseZone', entityId: created.id,
      after: { warehouseId, country, regions }, ip: actor.ip, userAgent: actor.userAgent,
    });
    return created;
  }

  async removeZone(zoneId: string, actor: ActorMeta) {
    await this.prisma.warehouseZone.delete({ where: { id: zoneId } });
    await this.audit.record({
      actorUserId: actor.userId, action: 'warehouse.zone.remove', entityType: 'WarehouseZone', entityId: zoneId,
      ip: actor.ip, userAgent: actor.userAgent,
    });
    return { ok: true };
  }

  /** Public read used by the seller portal "where can I send inbound?" picker. */
  publicList() {
    return this.prisma.warehouse.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { priority: 'asc' },
      select: {
        id: true, code: true, displayName: true, country: true, region: true, city: true,
        zones: { select: { country: true, regions: true } },
      },
    });
  }
}
