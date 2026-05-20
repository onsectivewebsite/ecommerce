import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { OrdersService } from './orders.service';
import { CheckoutDto } from './dto';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';

@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post('checkout')
  @UseGuards(RateLimitGuard)
  @RateLimit({ rule: 'orders.checkout', max: 5, windowSec: 60, scope: 'user' })
  checkout(@CurrentUser() u: RequestUser, @Body() dto: CheckoutDto) {
    return this.orders.checkout(u.userId, dto);
  }

  @Get()
  list(@CurrentUser() u: RequestUser) {
    return this.orders.listMine(u.userId);
  }

  @Get(':id')
  get(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.orders.get(u.userId, u.role, id);
  }
}
