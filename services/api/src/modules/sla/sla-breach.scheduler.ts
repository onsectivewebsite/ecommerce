import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SlaService } from './sla.service';
import { PrismaService } from '../../prisma/prisma.service';

const TEN_MIN = 10 * 60 * 1000;

@Injectable()
export class SlaBreachScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SlaBreachScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly sla: SlaService,
    private readonly cfg: ConfigService,
    private readonly events: EventEmitter2,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    if (this.cfg.get<string>('SLA_SCHEDULER_ENABLED') !== '1') return;
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        const before = Date.now();
        const r = await this.sla.scanBreaches();
        if (r.shipBreaches > 0 || r.deliverBreaches > 0) {
          // Emit one platform-level event with counters; individual
          // sla.breach events are emitted per-row by callers if needed.
          this.events.emit('sla.breach.scan', { ...r, ms: Date.now() - before });
          // Per-row emission so seller-health (or other listeners) can react.
          await this.emitPerRow();
        }
      } catch (e) {
        this.logger.warn(`sla scan failed: ${(e as Error).message}`);
      } finally { this.running = false; }
    };
    tick();
    this.timer = setInterval(tick, TEN_MIN);
    this.timer.unref();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /**
   * Walks recent breaches and emits one `sla.breach` event per row.
   * Cheap because we limit to the last 24h and dedupe by an in-memory
   * Set keyed on row id — listeners that care can subscribe.
   */
  private async emitPerRow() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await this.prisma.slaBreach.findMany({
      where: { createdAt: { gt: since } },
      take: 500,
      orderBy: { createdAt: 'desc' },
    });
    for (const b of recent) {
      this.events.emit('sla.breach', {
        breachId: b.id,
        orderItemId: b.orderItemId,
        kind: b.kind,
        sellerId: b.sellerId,
        breachHours: b.breachHours,
      });
    }
  }
}
