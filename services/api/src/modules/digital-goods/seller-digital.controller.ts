import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { DigitalGoodsService } from './digital-goods.service';
import { ImportLicenseKeysDto, UpsertDigitalProductDto } from './dto';

@ApiTags('seller-digital')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER', 'ADMIN')
@Controller('seller/digital')
export class SellerDigitalController {
  constructor(private readonly digital: DigitalGoodsService) {}

  @Get(':productId')
  get(@CurrentUser() u: RequestUser, @Param('productId') productId: string) {
    return this.digital.getForSeller(u.userId, productId);
  }

  @Put(':productId')
  upsert(
    @CurrentUser() u: RequestUser,
    @Param('productId') productId: string,
    @Body() dto: UpsertDigitalProductDto,
  ) {
    return this.digital.upsert(u.userId, productId, dto);
  }

  @Post(':productId/license-keys')
  importKeys(
    @CurrentUser() u: RequestUser,
    @Param('productId') productId: string,
    @Body() dto: ImportLicenseKeysDto,
  ) {
    return this.digital.importLicenseKeys(u.userId, productId, dto.keys);
  }
}
