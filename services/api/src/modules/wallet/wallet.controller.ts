import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { WalletService } from './wallet.service';
import { GrantCreditDto } from './dto';

function actor(u: RequestUser, req: Request) {
  return { userId: u.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined };
}

@ApiTags('wallet')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  statement(@CurrentUser() u: RequestUser) {
    return this.wallet.statement(u.userId);
  }
}

@ApiTags('admin-wallet')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/wallet')
export class AdminWalletController {
  constructor(private readonly wallet: WalletService) {}

  @Post('grant')
  grant(@CurrentUser() u: RequestUser, @Body() dto: GrantCreditDto, @Req() req: Request) {
    return this.wallet.grant(u.userId, dto, actor(u, req));
  }
}
