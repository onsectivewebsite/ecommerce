import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { CartService } from './cart.service';
import { AddCartItemDto, UpdateCartItemDto } from './dto';

@ApiTags('cart')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  get(@CurrentUser() u: RequestUser) {
    return this.cart.getOrCreate(u.userId);
  }

  @Post('items')
  add(@CurrentUser() u: RequestUser, @Body() dto: AddCartItemDto) {
    return this.cart.addItem(u.userId, dto.variantId, dto.qty);
  }

  @Patch('items/:id')
  update(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body() dto: UpdateCartItemDto) {
    return this.cart.updateItem(u.userId, id, dto.qty);
  }

  @Delete('items/:id')
  remove(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.cart.removeItem(u.userId, id);
  }
}
