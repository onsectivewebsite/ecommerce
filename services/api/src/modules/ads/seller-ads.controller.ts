import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { AdsService } from './ads.service';
import { AddPlacementDto, CreateCampaignDto, TopUpDto, UpdateCampaignDto } from './dto';

@ApiTags('seller-ads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER', 'ADMIN')
@Controller('seller/ads')
export class SellerAdsController {
  constructor(private readonly ads: AdsService) {}

  @Get('budget')
  budget(@CurrentUser() u: RequestUser) {
    return this.ads.budgetBalance(u.userId);
  }

  @Post('top-up')
  topUp(@CurrentUser() u: RequestUser, @Body() dto: TopUpDto) {
    return this.ads.startTopUp(u.userId, dto.amountMinor, dto.paymentProvider);
  }

  @Get('campaigns')
  list(@CurrentUser() u: RequestUser) {
    return this.ads.listCampaigns(u.userId);
  }

  @Post('campaigns')
  create(@CurrentUser() u: RequestUser, @Body() dto: CreateCampaignDto) {
    return this.ads.createCampaign(u.userId, dto);
  }

  @Get('campaigns/:id')
  get(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.ads.getCampaign(u.userId, id);
  }

  @Patch('campaigns/:id')
  update(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body() dto: UpdateCampaignDto) {
    return this.ads.updateCampaign(u.userId, id, dto);
  }

  @Post('campaigns/:id/placements')
  addPlacement(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body() dto: AddPlacementDto) {
    return this.ads.addPlacement(u.userId, id, dto);
  }

  @Delete('placements/:id')
  removePlacement(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.ads.deletePlacement(u.userId, id);
  }
}
