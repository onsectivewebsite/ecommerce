import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InventoryService } from './inventory.service';

const SWEEP_INTERVAL_MS = 60_000; // 1 minute

/**
 * Background sweeper that releases expired reservations.
 *
 * Lock semantics: with one API replica we don't need cross-process coordination.
 * If we deploy multiple replicas in Phase 6, layer a Redis SETNX lock here —
 * the sweeper only needs *one* process to win each minute.
 */
@Injectable()
export class ReservationSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReservationSweeper.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly inventory: InventoryService) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.inventory.sweepExpired().catch((e) => this.logger.warn(`Sweep failed: ${(e as Error).message}`));
    }, SWEEP_INTERVAL_MS);
    // Don't keep the event loop alive solely for the sweeper
    this.timer.unref?.();
    this.logger.log(`Reservation sweeper running every ${SWEEP_INTERVAL_MS / 1000}s`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
