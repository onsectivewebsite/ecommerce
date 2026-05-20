import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { StorageFeesService } from './storage-fees.service';

@ApiTags('seller-storage')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER', 'ADMIN')
@Controller('seller/storage')
export class StorageFeesController {
  constructor(private readonly fees: StorageFeesService) {}

  @Get('statement')
  statement(@CurrentUser() u: RequestUser, @Query('days') days?: string) {
    return this.fees.statementForSeller(u.userId, days ? Number(days) : 30);
  }
}
