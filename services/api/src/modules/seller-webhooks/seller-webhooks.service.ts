import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { AuditService } from '../audit/audit.service';
import { KeyCrypto } from '../digital-goods/key-crypto';
import { generateSecret, sign } from './webhook-signer';
import type { WebhookEventKind } from '@prisma/client';
import type { CreateEndpointDto, UpdateEndpointDto } from './dto';

const MAX_ENDPOINTS_PER_SELLER = 5;
const RETRY_BACKOFF_MS = [
  60_000,          // 1 min
  5 * 60_000,      // 5 min
  30 * 60_000,     // 30 min
  2 * 60 * 60_000, // 2 h
  8 * 60 * 60_000, // 8 h
  24 * 60 * 60_000,// 24 h
];

interface ActorMeta { userId: string; ip?: string; userAgent?: string }

@Injectable()
export class SellerWebhooksService {
  private readonly logger = new Logger(SellerWebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: KeyCrypto,
  ) {}

  // ---------- CRUD ----------

  async list(sellerUserId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId: sellerUserId } });
    if (!seller) return [];
    return this.prisma.sellerWebhookEndpoint.findMany({
      where: { sellerId: seller.id },
      orderBy: { createdAt: 'desc' },
    }).then((rows) => rows.map(this.publicShape));
  }

  async create(sellerUserId: string, dto: CreateEndpointDto, actor: ActorMeta) {
    const seller = await this.prisma.seller.findUnique({ where: { userId: sellerUserId } });
    if (!seller) throw new ForbiddenException('Seller profile required');
    const count = await this.prisma.sellerWebhookEndpoint.count({ where: { sellerId: seller.id } });
    if (count >= MAX_ENDPOINTS_PER_SELLER) {
      throw new BadRequestException(`Max ${MAX_ENDPOINTS_PER_SELLER} endpoints per seller`);
    }
    const secret = generateSecret();
    const created = await this.prisma.sellerWebhookEndpoint.create({
      data: {
        id: newId(),
        sellerId: seller.id,
        name: dto.name,
        url: dto.url,
        events: dto.events,
        secretEncrypted: this.crypto.encrypt(secret),
        active: true,
      },
    });
    await this.audit.record({
      actorUserId: actor.userId, action: 'webhook.create', entityType: 'SellerWebhookEndpoint', entityId: created.id,
      after: { name: dto.name, url: dto.url, events: dto.events },
      ip: actor.ip, userAgent: actor.userAgent,
    });
    // Return the plaintext secret once — sellers must store it now.
    return { ...this.publicShape(created), secret };
  }

  async update(sellerUserId: string, id: string, dto: UpdateEndpointDto, actor: ActorMeta) {
    const endpoint = await this.ownOrThrow(sellerUserId, id);
    const updated = await this.prisma.sellerWebhookEndpoint.update({
      where: { id: endpoint.id },
      data: {
        name: dto.name ?? undefined,
        url: dto.url ?? undefined,
        events: dto.events ?? undefined,
        active: dto.active ?? undefined,
      },
    });
    await this.audit.record({
      actorUserId: actor.userId, action: 'webhook.update', entityType: 'SellerWebhookEndpoint', entityId: id,
      before: endpoint, after: updated,
      ip: actor.ip, userAgent: actor.userAgent,
    });
    return this.publicShape(updated);
  }

  async rotateSecret(sellerUserId: string, id: string, actor: ActorMeta) {
    const endpoint = await this.ownOrThrow(sellerUserId, id);
    const secret = generateSecret();
    await this.prisma.sellerWebhookEndpoint.update({
      where: { id: endpoint.id },
      data: { secretEncrypted: this.crypto.encrypt(secret) },
    });
    await this.audit.record({
      actorUserId: actor.userId, action: 'webhook.rotate', entityType: 'SellerWebhookEndpoint', entityId: id,
      ip: actor.ip, userAgent: actor.userAgent,
    });
    return { id, secret };
  }

  async remove(sellerUserId: string, id: string, actor: ActorMeta) {
    const endpoint = await this.ownOrThrow(sellerUserId, id);
    await this.prisma.sellerWebhookEndpoint.delete({ where: { id: endpoint.id } });
    await this.audit.record({
      actorUserId: actor.userId, action: 'webhook.delete', entityType: 'SellerWebhookEndpoint', entityId: id,
      ip: actor.ip, userAgent: actor.userAgent,
    });
    return { ok: true };
  }

  async listDeliveries(sellerUserId: string, endpointId: string) {
    await this.ownOrThrow(sellerUserId, endpointId);
    return this.prisma.sellerWebhookDelivery.findMany({
      where: { endpointId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  // ---------- enqueue + dispatch ----------

  /**
   * Public entrypoint for the event-bus listener: find every endpoint
   * subscribed to this event and queue a delivery row per endpoint.
   */
  async enqueueForSeller(sellerId: string, event: WebhookEventKind, payload: Record<string, unknown>) {
    const endpoints = await this.prisma.sellerWebhookEndpoint.findMany({
      where: { sellerId, active: true, events: { has: event } },
    });
    if (endpoints.length === 0) return;
    await Promise.all(endpoints.map((e) =>
      this.prisma.sellerWebhookDelivery.create({
        data: {
          id: newId(),
          endpointId: e.id,
          event,
          payload: payload as unknown as object,
          status: 'PENDING',
          nextAttemptAt: new Date(),
        },
      }),
    ));
  }

  /** Scheduler entrypoint: send all PENDING + due deliveries, mark per result. */
  async dispatchDue(limit = 100): Promise<{ attempted: number; delivered: number; dead: number }> {
    const now = new Date();
    const due = await this.prisma.sellerWebhookDelivery.findMany({
      where: {
        status: { in: ['PENDING', 'RETRYING'] },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      include: { endpoint: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    if (due.length === 0) return { attempted: 0, delivered: 0, dead: 0 };
    let delivered = 0, dead = 0;
    for (const d of due) {
      const result = await this.attemptDelivery(d);
      if (result === 'delivered') delivered++;
      else if (result === 'dead') dead++;
    }
    return { attempted: due.length, delivered, dead };
  }

  private async attemptDelivery(
    d: { id: string; endpointId: string; event: WebhookEventKind; payload: unknown; attempts: number; endpoint: { url: string; secretEncrypted: string; active: boolean } },
  ): Promise<'delivered' | 'retrying' | 'dead'> {
    if (!d.endpoint.active) {
      await this.prisma.sellerWebhookDelivery.update({
        where: { id: d.id }, data: { status: 'DEAD', lastError: 'endpoint disabled' },
      });
      return 'dead';
    }
    const secret = this.crypto.decrypt(d.endpoint.secretEncrypted);
    const ts = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ event: d.event, id: d.id, data: d.payload });
    const signature = sign(secret, body, ts);
    let respStatus: number | null = null;
    let errorText: string | null = null;
    try {
      const res = await fetch(d.endpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Onsective-Event': d.event,
          'X-Onsective-Signature': signature,
          'X-Onsective-Delivery': d.id,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      respStatus = res.status;
      if (res.status >= 200 && res.status < 300) {
        await this.prisma.sellerWebhookDelivery.update({
          where: { id: d.id },
          data: {
            status: 'DELIVERED',
            attempts: d.attempts + 1,
            lastAttemptAt: new Date(),
            lastResponseStatus: respStatus,
            lastError: null,
            nextAttemptAt: null,
          },
        });
        return 'delivered';
      }
      errorText = `HTTP ${res.status}`;
    } catch (e) {
      errorText = (e as Error).message.slice(0, 500);
    }
    // Failure → schedule retry or mark dead.
    const nextAttempts = d.attempts + 1;
    const backoff = RETRY_BACKOFF_MS[nextAttempts - 1] ?? null;
    if (backoff === null) {
      await this.prisma.sellerWebhookDelivery.update({
        where: { id: d.id },
        data: {
          status: 'DEAD',
          attempts: nextAttempts,
          lastAttemptAt: new Date(),
          lastResponseStatus: respStatus,
          lastError: errorText,
          nextAttemptAt: null,
        },
      });
      this.logger.warn(`webhook ${d.id} DEAD after ${nextAttempts} attempts (${errorText})`);
      return 'dead';
    }
    await this.prisma.sellerWebhookDelivery.update({
      where: { id: d.id },
      data: {
        status: 'RETRYING',
        attempts: nextAttempts,
        lastAttemptAt: new Date(),
        lastResponseStatus: respStatus,
        lastError: errorText,
        nextAttemptAt: new Date(Date.now() + backoff),
      },
    });
    return 'retrying';
  }

  // ---------- helpers ----------

  private async ownOrThrow(sellerUserId: string, endpointId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId: sellerUserId } });
    if (!seller) throw new ForbiddenException('Seller profile required');
    const endpoint = await this.prisma.sellerWebhookEndpoint.findUnique({ where: { id: endpointId } });
    if (!endpoint || endpoint.sellerId !== seller.id) throw new NotFoundException('Endpoint not found');
    return endpoint;
  }

  private publicShape = (row: {
    id: string; name: string; url: string; events: WebhookEventKind[]; active: boolean;
    createdAt: Date; updatedAt: Date;
  }) => ({
    id: row.id,
    name: row.name,
    url: row.url,
    events: row.events,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
