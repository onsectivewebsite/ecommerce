import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, Length } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { RateLimiterService } from './rate-limiter.service';

class ManualBlockDto {
  @IsString() @Length(2, 80) ruleId!: string;
  @IsString() @Length(3, 200) key!: string;
  @IsString() @Length(3, 500) reason!: string;
  @IsOptional() @IsISO8601() blockedUntil?: string;
}

class UnblockDto {
  @IsString() @Length(3, 200) key!: string;
}

@ApiTags('admin-rate-limits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/security/rate-limits')
export class RateLimitAdminController {
  constructor(private readonly svc: RateLimiterService) {}

  @Get('events')
  events(@Query('ruleId') ruleId?: string, @Query('limit') limit?: string) {
    return this.svc.recentEvents({
      ruleId,
      limit: limit ? Number(limit) : 100,
    });
  }

  @Get('blocks')
  blocks(@Query('active') active?: string) {
    return this.svc.listBlocks({ activeOnly: active === '1' || active === 'true' });
  }

  @Post('block')
  block(@CurrentUser() u: RequestUser, @Body() dto: ManualBlockDto) {
    return this.svc.manualBlock({
      ruleId: dto.ruleId,
      key: dto.key,
      reason: dto.reason,
      blockedUntil: dto.blockedUntil ? new Date(dto.blockedUntil) : null,
      blockedByUserId: u.userId,
    });
  }

  @Post('unblock')
  async unblock(@Body() dto: UnblockDto) {
    await this.svc.unblock(dto.key);
    return { ok: true };
  }
}
