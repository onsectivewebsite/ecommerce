import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AdPlacementType } from '@prisma/client';
import { AdsService } from './ads.service';
import { AuctionService } from './auction.service';
import { ImpressionDto } from './dto';

const SAFE_PLACEMENTS: AdPlacementType[] = ['SPONSORED_PRODUCT', 'SEARCH_SPONSOR', 'BANNER_SLOT'];

@ApiTags('ads')
@Controller('ads')
export class AdsController {
  constructor(
    private readonly ads: AdsService,
    private readonly auction: AuctionService,
  ) {}

  // ---- Buyer-side serve & track ----

  @Get('serve/:type')
  serve(
    @Param('type') type: string,
    @Query('q') q?: string,
    @Query('category') category?: string,
    @Query('exclude') exclude?: string,
  ) {
    const t = type.toUpperCase() as AdPlacementType;
    if (!SAFE_PLACEMENTS.includes(t)) return null;
    return this.auction.resolve(t, {
      searchKeyword: q?.toLowerCase(),
      categorySlug: category,
      excludeCampaignIds: exclude ? exclude.split(',') : undefined,
    });
  }

  @Post('impression')
  impression(@Body() dto: ImpressionDto) {
    return this.ads.recordImpression(dto);
  }

  /**
   * GET so the buyer-web can render an anchor; we 302 to the destination
   * to keep the click count outside the JS bundle (works without JS too).
   */
  @Get('click/:placementId')
  async click(
    @Param('placementId') placementId: string,
    @Query('k') eventKey: string | undefined,
    @Query('sid') sid: string | undefined,
    @Res() res: Response,
  ) {
    const { destinationUrl } = await this.ads.recordClick(placementId, sid, eventKey);
    return res.redirect(302, destinationUrl);
  }
}
