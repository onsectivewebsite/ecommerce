import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Lightweight in-process counters/gauges. Exposed as Prometheus text from
 * MetricsController. Avoiding a full prom-client dependency keeps the
 * footprint small; if we need histograms or push-gateway support later we
 * swap in prom-client.
 */
@Injectable()
export class MetricsService {
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  inc(name: string, labels: Record<string, string> = {}, by = 1) {
    const k = this.key(name, labels);
    this.counters.set(k, (this.counters.get(k) ?? 0) + by);
  }

  setGauge(name: string, value: number, labels: Record<string, string> = {}) {
    const k = this.key(name, labels);
    this.gauges.set(k, value);
  }

  // ---------- event-driven counter wiring ----------

  @OnEvent('order.placed')
  onOrderPlaced() { this.inc('onsective_orders_total', { status: 'placed' }); }

  @OnEvent('order.paid')
  onOrderPaid() { this.inc('onsective_orders_total', { status: 'paid' }); }

  @OnEvent('order.refunded')
  onOrderRefunded() { this.inc('onsective_orders_total', { status: 'refunded' }); }

  @OnEvent('risk.assessed')
  onRisk(payload: { decision: string }) {
    this.inc('onsective_risk_decisions_total', { decision: payload.decision });
  }

  // ---------- prometheus rendering ----------

  async render(): Promise<string> {
    // Refresh gauges that are cheap to compute on-demand.
    try {
      const [heldOrders, activeSellers] = await Promise.all([
        this.prisma.orderHold.count({ where: { status: 'OPEN' } }),
        this.prisma.seller.count({ where: { status: 'APPROVED' } }),
      ]);
      this.setGauge('onsective_held_orders', heldOrders);
      this.setGauge('onsective_active_sellers', activeSellers);
    } catch {/* swallow: metrics must never block scraping */}

    const lines: string[] = [];
    for (const [key, value] of this.counters) {
      lines.push(`${key} ${value}`);
    }
    for (const [key, value] of this.gauges) {
      lines.push(`${key} ${value}`);
    }
    return lines.join('\n') + '\n';
  }

  private key(name: string, labels: Record<string, string>): string {
    const parts = Object.entries(labels)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`);
    return parts.length > 0 ? `${name}{${parts.join(',')}}` : name;
  }
}
