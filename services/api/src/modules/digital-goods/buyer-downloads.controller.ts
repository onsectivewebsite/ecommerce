import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { DigitalGoodsService } from './digital-goods.service';
import { DeliveryService } from './delivery.service';

@ApiTags('buyer-downloads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('downloads')
export class BuyerDownloadsController {
  constructor(
    private readonly digital: DigitalGoodsService,
    private readonly delivery: DeliveryService,
  ) {}

  @Get()
  listMine(@CurrentUser() u: RequestUser) {
    return this.delivery.listForUser(u.userId);
  }

  @Get(':id/key')
  revealKey(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.digital.revealKeyForBuyer(u.userId, id);
  }

  @Post(':id/url')
  mintUrl(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.digital.mintDownloadUrl(u.userId, id);
  }
}
