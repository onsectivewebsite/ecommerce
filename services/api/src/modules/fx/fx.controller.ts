import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { FxService } from './fx.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';

@ApiTags('fx')
@Controller('fx')
export class FxController {
  constructor(private readonly fx: FxService) {}

  /** Public — buyer-web reads this once on boot to know which currencies it can offer. */
  @Get('rates')
  rates() {
    return this.fx.listLatest();
  }

  /** Public — quick converter; rate-limited at the ingress level in production. */
  @Get('convert')
  async convert(
    @Query('amountMinor') amountMinor: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    const amt = Number(amountMinor);
    if (!Number.isFinite(amt) || amt < 0) throw new BadRequestException('amountMinor required');
    if (!from || !to) throw new BadRequestException('from + to required');
    return this.fx.convertMinor(amt, from, to);
  }

  /** Admin trigger — useful for ops to force a refresh after a missing-rate alert. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @Get('refresh')
  refresh() {
    return this.fx.refresh();
  }
}
