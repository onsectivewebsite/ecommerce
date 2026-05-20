import { Controller, ForbiddenException, Get, Header, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { MetricsService } from './metrics.service';

@ApiTags('observability')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('content-type', 'text/plain; version=0.0.4')
  async scrape(@Req() req: Request) {
    const expected = process.env.METRICS_TOKEN;
    if (!expected) {
      // Disabled by default to avoid accidentally exposing internal data.
      throw new ForbiddenException('Metrics disabled. Set METRICS_TOKEN to enable.');
    }
    const auth = req.headers['authorization'] ?? '';
    const supplied = typeof auth === 'string' && auth.startsWith('Bearer ')
      ? auth.slice('Bearer '.length)
      : (req.query.token as string | undefined) ?? '';
    if (supplied !== expected) throw new ForbiddenException('Bad metrics token');
    return this.metrics.render();
  }
}
