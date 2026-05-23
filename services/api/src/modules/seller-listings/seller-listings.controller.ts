import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { SellerListingsService } from './seller-listings.service';
import { CreateListingDto, UpdateListingDto } from './dto';

@ApiTags('seller-listings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER', 'ADMIN')
@Controller('seller/listings')
export class SellerListingsController {
  constructor(private readonly svc: SellerListingsService) {}

  @Get()
  list(@CurrentUser() u: RequestUser) {
    return this.svc.listMine(u.userId);
  }

  @Post()
  create(@CurrentUser() u: RequestUser, @Body() dto: CreateListingDto) {
    return this.svc.create(u.userId, dto);
  }

  @Patch(':id')
  update(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body() dto: UpdateListingDto) {
    return this.svc.update(u.userId, id, dto);
  }

  @Post(':id/deactivate')
  deactivate(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.svc.deactivate(u.userId, id);
  }

  @Post(':id/reactivate')
  reactivate(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.svc.reactivate(u.userId, id);
  }
}
