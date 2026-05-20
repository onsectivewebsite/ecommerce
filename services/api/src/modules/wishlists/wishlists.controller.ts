import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { WishlistsService } from './wishlists.service';
import { AddWishlistItemDto } from './dto';

@ApiTags('wishlists')
@Controller('wishlists')
export class WishlistsController {
  constructor(private readonly wishlists: WishlistsService) {}

  /** Public — anyone with the share token can view. */
  @Get('shared/:token')
  shared(@Param('token') token: string) {
    return this.wishlists.publicByToken(token);
  }

  // ---- authenticated buyer ----
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get()
  mine(@CurrentUser() u: RequestUser) {
    return this.wishlists.getDefault(u.userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('items')
  add(@CurrentUser() u: RequestUser, @Body() dto: AddWishlistItemDto) {
    return this.wishlists.addItem(u.userId, dto.productId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete('items/:productId')
  remove(@CurrentUser() u: RequestUser, @Param('productId') productId: string) {
    return this.wishlists.removeItem(u.userId, productId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('share')
  share(@CurrentUser() u: RequestUser) {
    return this.wishlists.rotateShareToken(u.userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete('share')
  unshare(@CurrentUser() u: RequestUser) {
    return this.wishlists.clearShareToken(u.userId);
  }
}
