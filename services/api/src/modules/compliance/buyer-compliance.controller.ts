import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CategoryRulesService } from './category-rules.service';
import { AgeConsentService } from './age-consent.service';
import { AgeConsentDto } from './dto';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';

@ApiTags('compliance')
@Controller('compliance')
export class BuyerComplianceController {
  constructor(
    private readonly rules: CategoryRulesService,
    private readonly age: AgeConsentService,
  ) {}

  /** Public — buyer-web reads this before showing the PDP age gate or country warning. */
  @Get('rules/:slug')
  async ruleForCategory(@Param('slug') slug: string) {
    const rule = await this.rules.getByCategorySlug(slug);
    return rule ?? { categorySlug: slug, minBuyerAge: null, blockedCountries: [], allowedCountries: [], requirementKinds: [], requiresSellerDoc: false, notes: null };
  }

  /**
   * Records an age consent. Works both for logged-in buyers (binds to userId)
   * and anonymous PDP visitors (binds to sessionId). Throws 400 if buyer is
   * under the required age for the named product/category.
   */
  @UseGuards(JwtAuthGuard)
  @Post('age-consent')
  async submitConsentLoggedIn(
    @Req() req: Request,
    @CurrentUser() u: RequestUser,
    @Body() dto: AgeConsentDto,
  ) {
    return this.age.record({
      userId: u.userId,
      sessionId: dto.sessionId,
      productId: dto.productId ?? null,
      categoryId: dto.categoryId ?? null,
      dob: new Date(dto.dob),
      method: dto.method ?? 'SELF_DECLARATION',
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Post('age-consent/guest')
  async submitConsentGuest(@Req() req: Request, @Body() dto: AgeConsentDto) {
    const sessionId = dto.sessionId ?? 'guest-' + Math.random().toString(36).slice(2, 10);
    return this.age.record({
      userId: null,
      sessionId,
      productId: dto.productId ?? null,
      categoryId: dto.categoryId ?? null,
      dob: new Date(dto.dob),
      method: dto.method ?? 'SELF_DECLARATION',
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }
}
