import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { InventoryForecastService } from './inventory-forecast.service';

@ApiTags('seller-inventory-forecast')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER', 'ADMIN')
@Controller('seller/inventory/alerts')
export class InventoryForecastController {
  constructor(private readonly forecast: InventoryForecastService) {}

  @Get()
  list(@CurrentUser() u: RequestUser, @Query('includeAcknowledged') includeAcked?: string) {
    return this.forecast.listForSeller(u.userId, includeAcked === '1');
  }

  @Post(':id/acknowledge')
  acknowledge(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.forecast.acknowledge(u.userId, id);
  }
}
