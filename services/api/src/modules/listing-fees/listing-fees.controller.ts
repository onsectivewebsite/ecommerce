import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { ListingFeesService } from './listing-fees.service';
import { CreateListingFeeRuleDto, UpdateListingFeeRuleDto } from './dto';

@ApiTags('listing-fees')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/listing-fees')
export class ListingFeesController {
  constructor(private readonly fees: ListingFeesService) {}

  @Get()
  list(@Query('sellerId') sellerId?: string) {
    return this.fees.list({ sellerId });
  }

  @Get('charges')
  charges(@Query('sellerId') sellerId?: string, @Query('productId') productId?: string, @Query('limit') limit?: string) {
    return this.fees.listCharges({ sellerId, productId, limit: limit ? Number(limit) : undefined });
  }

  @Post()
  create(@CurrentUser() u: RequestUser, @Body() dto: CreateListingFeeRuleDto, @Req() req: Request) {
    return this.fees.create(dto, { userId: u.userId, ip: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Patch(':id')
  update(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body() dto: UpdateListingFeeRuleDto, @Req() req: Request) {
    return this.fees.update(id, dto, { userId: u.userId, ip: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Delete(':id')
  remove(@CurrentUser() u: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.fees.remove(id, { userId: u.userId, ip: req.ip, userAgent: req.headers['user-agent'] });
  }
}
