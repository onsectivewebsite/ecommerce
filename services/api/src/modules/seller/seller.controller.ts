import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { SellerService } from './seller.service';
import { CreateProductDto, CreateSellerProfileDto } from './dto';

class UpdateVariantInventoryDto {
  @IsInt() @Min(0)
  inventoryQty!: number;
}

@ApiTags('seller')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('seller')
export class SellerController {
  constructor(private readonly seller: SellerService) {}

  @Post('profile')
  createProfile(@CurrentUser() u: RequestUser, @Body() dto: CreateSellerProfileDto) {
    return this.seller.createProfile(u.userId, dto);
  }

  @Get('profile')
  myProfile(@CurrentUser() u: RequestUser) {
    return this.seller.getMyProfileOrThrow(u.userId);
  }

  @Roles('SELLER', 'ADMIN')
  @Get('products')
  listProducts(
    @CurrentUser() u: RequestUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.seller.listMyProducts(u.userId, page ? Number(page) : 1, pageSize ? Number(pageSize) : 20);
  }

  @Roles('SELLER', 'ADMIN')
  @Post('products')
  createProduct(@CurrentUser() u: RequestUser, @Body() dto: CreateProductDto) {
    return this.seller.createProduct(u.userId, dto);
  }

  @Roles('SELLER', 'ADMIN')
  @Patch('products/variants/:id')
  updateVariantInventory(
    @CurrentUser() u: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateVariantInventoryDto,
  ) {
    return this.seller.updateVariantInventory(u.userId, id, dto.inventoryQty);
  }

  @Roles('SELLER', 'ADMIN')
  @Get('orders')
  listOrders(@CurrentUser() u: RequestUser) {
    return this.seller.listMyOrders(u.userId);
  }
}
