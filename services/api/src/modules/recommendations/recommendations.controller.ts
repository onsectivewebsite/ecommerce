import { BadRequestException, Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt.guard';
import type { RequestUser } from '../../common/current-user.decorator';
import { RecommendationsService } from './recommendations.service';

@ApiTags('recommendations')
@Controller('recommendations')
export class RecommendationsController {
  constructor(private readonly recs: RecommendationsService) {}

  @Get('fbt')
  fbt(@Query('productId') productId?: string) {
    if (!productId) throw new BadRequestException('productId required');
    return this.recs.fbt(productId);
  }

  @Get('similar')
  similar(@Query('productId') productId?: string) {
    if (!productId) throw new BadRequestException('productId required');
    return this.recs.similar(productId);
  }

  /**
   * Personalized rail. Returns "for-you" if signed in (via optional JWT),
   * falls back to latest-active for anonymous visitors.
   */
  @Get('for-you')
  forYou(@Req() req: Request) {
    const user = (req as any).user as RequestUser | undefined;
    return this.recs.forYou(user?.userId ?? null);
  }

  // Authenticated variant kept around for clients that want to force the personalized path.
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('mine')
  mine(@Req() req: Request) {
    const user = (req as any).user as RequestUser;
    return this.recs.forYou(user.userId);
  }
}
