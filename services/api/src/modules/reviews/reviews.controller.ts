import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
import { ReviewsService } from './reviews.service';
import { AdminHideDto, CreateReviewDto, SellerReplyDto } from './dto';

function actor(u: RequestUser, req: Request) {
  return { userId: u.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined };
}

@ApiTags('reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  /** Public — PDP pulls reviews + aggregate via this endpoint. */
  @Get('product/:productId')
  forProduct(
    @Param('productId') productId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.reviews.publicListForProduct(
      productId,
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 20,
    );
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post()
  create(@CurrentUser() u: RequestUser, @Body() dto: CreateReviewDto, @Req() req: Request) {
    return this.reviews.create(u.userId, dto, actor(u, req));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('mine')
  mine(@CurrentUser() u: RequestUser) {
    return this.reviews.myReviews(u.userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@CurrentUser() u: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.reviews.deleteByBuyer(u.userId, id, actor(u, req));
  }
}

@ApiTags('seller-reviews')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER', 'ADMIN')
@Controller('seller/reviews')
export class SellerReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  list(@CurrentUser() u: RequestUser) {
    return this.reviews.listForSeller(u.userId);
  }

  @Post(':id/reply')
  reply(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body() dto: SellerReplyDto, @Req() req: Request) {
    return this.reviews.sellerReply(u.userId, id, dto, actor(u, req));
  }
}

@ApiTags('admin-reviews')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/reviews')
export class AdminReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.reviews.adminList(status);
  }

  @Post(':id/hide')
  hide(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body() dto: AdminHideDto, @Req() req: Request) {
    return this.reviews.adminHide(id, dto, actor(u, req));
  }

  @Post(':id/unhide')
  unhide(@CurrentUser() u: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.reviews.adminUnhide(id, actor(u, req));
  }
}
