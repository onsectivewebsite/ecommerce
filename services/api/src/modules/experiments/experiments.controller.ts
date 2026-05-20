import { Body, Controller, Get, Headers, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { ExperimentsService, type Variant } from './experiments.service';

@ApiTags('experiments')
@Controller('experiments')
export class ExperimentsController {
  constructor(private readonly experiments: ExperimentsService) {}

  /**
   * GrowthBook-compatible features payload. The SDK polls this once and re-asks
   * every few minutes. Identity comes from `x-onsective-sid` header (anonymous)
   * or the bearer token (authenticated).
   */
  @Get('features')
  async features(@Req() req: Request, @Headers('x-onsective-sid') sid?: string) {
    const userId = (req as any).user?.userId ?? null;
    return this.experiments.featurePayload({ userId, sessionId: sid ?? null });
  }

  /** Lightweight POST so the SDK can confirm an exposure for sticky assignments. */
  @Post('exposure')
  async exposure(
    @Req() req: Request,
    @Headers('x-onsective-sid') sid: string | undefined,
    @Body() body: { experimentKey: string; context?: Record<string, unknown> },
  ) {
    const userId = (req as any).user?.userId ?? null;
    return this.experiments.logExposure(body.experimentKey, { userId, sessionId: sid ?? null }, body.context ?? {});
  }
}

@ApiTags('admin-experiments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/experiments')
export class AdminExperimentsController {
  constructor(private readonly experiments: ExperimentsService) {}

  @Get()
  list() { return this.experiments.listForAdmin(); }

  @Post(':key')
  upsert(@CurrentUser() _u: RequestUser, @Body() body: {
    key: string;
    status?: 'DRAFT' | 'RUNNING' | 'PAUSED' | 'CONCLUDED';
    description?: string;
    variants?: Variant[];
    traffic?: number;
  }) {
    return this.experiments.upsert(body.key, body);
  }
}
