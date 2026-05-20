import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { PickListService } from './pick-list.service';

@ApiTags('warehouse-pick-list')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SHIPPER', 'ADMIN')
@Controller('warehouse/:id')
export class PickListController {
  constructor(private readonly svc: PickListService) {}

  @Get('summary')
  summary(@Param('id') id: string) {
    return this.svc.warehouseSummary(id);
  }

  @Get('pick-list')
  pickList(@Param('id') id: string) {
    return this.svc.pickListForWarehouse(id);
  }
}
