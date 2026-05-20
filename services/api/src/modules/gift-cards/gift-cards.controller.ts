import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import type { Request } from 'express';
import { GiftCardStatus } from '@prisma/client';
import type { PaymentProvider } from '@onsective/shared-types';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { GiftCardsService } from './gift-cards.service';
import { GiftCardsScheduler } from './gift-cards.scheduler';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';

class PurchaseGiftCardDto {
  @IsInt() @Min(500) @Max(100_000) amountMinor!: number;
  @IsOptional() @IsString() @Length(3, 8) currency?: string;
  @IsEmail() recipientEmail!: string;
  @IsOptional() @IsString() @Length(1, 120) recipientName?: string;
  @IsOptional() @IsString() @Length(1, 120) senderName?: string;
  @IsOptional() @IsString() @Length(1, 500) message?: string;
  @IsOptional() @IsString() deliverAt?: string;
  @IsOptional() @IsString() paymentProvider?: PaymentProvider;
}

class RedeemGiftCardDto {
  @IsString() @Length(4, 40) code!: string;
}

class AdminIssueGiftCardDto {
  @IsInt() @Min(500) @Max(100_000) amountMinor!: number;
  @IsOptional() @IsString() @Length(3, 8) currency?: string;
  @IsEmail() recipientEmail!: string;
  @IsOptional() @IsString() @Length(1, 120) recipientName?: string;
  @IsOptional() @IsString() @Length(1, 120) senderName?: string;
  @IsOptional() @IsString() @Length(1, 500) message?: string;
  @IsOptional() @IsString() expiresAt?: string;
}

function meta(u: RequestUser, req: Request) {
  return {
    userId: u.userId,
    ip: req.ip ?? null,
    userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
  };
}

@ApiTags('gift-cards')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('gift-cards')
export class GiftCardsController {
  constructor(private readonly giftCards: GiftCardsService) {}

  @UseGuards(RateLimitGuard)
  @RateLimit({ rule: 'giftcard.purchase', max: 10, windowSec: 3600, scope: 'user' })
  @Post('purchase')
  purchase(@CurrentUser() u: RequestUser, @Body() dto: PurchaseGiftCardDto) {
    return this.giftCards.purchase(u.userId, dto);
  }

  @Get('check')
  check(@Query('code') code: string) {
    return this.giftCards.check(code ?? '');
  }

  @UseGuards(RateLimitGuard)
  @RateLimit({ rule: 'giftcard.redeem', max: 10, windowSec: 3600, scope: 'user' })
  @Post('redeem')
  redeem(@CurrentUser() u: RequestUser, @Body() dto: RedeemGiftCardDto) {
    return this.giftCards.redeem(u.userId, dto.code);
  }

  @Get('mine')
  mine(@CurrentUser() u: RequestUser) {
    return this.giftCards.mine(u.userId);
  }
}

@ApiTags('admin-gift-cards')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/gift-cards')
export class AdminGiftCardsController {
  constructor(
    private readonly giftCards: GiftCardsService,
    private readonly scheduler: GiftCardsScheduler,
  ) {}

  @Get()
  list(@Query('status') status?: GiftCardStatus, @Query('q') q?: string) {
    return this.giftCards.adminList({ status, q });
  }

  @Post('issue')
  issue(
    @CurrentUser() u: RequestUser,
    @Body() dto: AdminIssueGiftCardDto,
    @Req() req: Request,
  ) {
    return this.giftCards.adminIssue(u.userId, dto, meta(u, req));
  }

  @Post(':id/void')
  void(@CurrentUser() u: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.giftCards.adminVoid(u.userId, id, meta(u, req));
  }

  @Post('deliver-due')
  deliverDue() {
    return this.scheduler.scan();
  }
}
