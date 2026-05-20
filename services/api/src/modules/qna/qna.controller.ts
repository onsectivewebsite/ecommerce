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
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { QnaService } from './qna.service';
import { AdminHideQnaDto, AnswerDto, AskQuestionDto } from './dto';

function actor(u: RequestUser, req: Request) {
  return { userId: u.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined };
}

@ApiTags('qna')
@Controller('qna')
export class QnaController {
  constructor(private readonly qna: QnaService) {}

  /** Public — PDP pulls questions + answers via this endpoint. */
  @Get('product/:productId')
  forProduct(
    @Param('productId') productId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.qna.publicListForProduct(
      productId,
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 20,
    );
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('mine')
  mine(@CurrentUser() u: RequestUser) {
    return this.qna.mine(u.userId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @RateLimit({ rule: 'qna.ask', max: 20, windowSec: 3600, scope: 'user' })
  @Post('questions')
  ask(@CurrentUser() u: RequestUser, @Body() dto: AskQuestionDto, @Req() req: Request) {
    return this.qna.ask(u.userId, dto, actor(u, req));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RateLimitGuard)
  @RateLimit({ rule: 'qna.answer', max: 30, windowSec: 3600, scope: 'user' })
  @Post('questions/:id/answers')
  answer(
    @CurrentUser() u: RequestUser,
    @Param('id') id: string,
    @Body() dto: AnswerDto,
    @Req() req: Request,
  ) {
    return this.qna.answer(u.userId, u.role, id, dto, actor(u, req));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('answers/:id/helpful')
  helpful(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.qna.toggleHelpful(u.userId, id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete('questions/:id')
  removeQuestion(@CurrentUser() u: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.qna.deleteQuestion(u.userId, id, actor(u, req));
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete('answers/:id')
  removeAnswer(@CurrentUser() u: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.qna.deleteAnswer(u.userId, id, actor(u, req));
  }
}

@ApiTags('seller-qna')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER', 'ADMIN')
@Controller('seller/qna')
export class SellerQnaController {
  constructor(private readonly qna: QnaService) {}

  @Get()
  list(@CurrentUser() u: RequestUser) {
    return this.qna.listForSeller(u.userId);
  }

  @Post('questions/:id/answers')
  answer(
    @CurrentUser() u: RequestUser,
    @Param('id') id: string,
    @Body() dto: AnswerDto,
    @Req() req: Request,
  ) {
    return this.qna.answer(u.userId, u.role, id, dto, actor(u, req));
  }
}

@ApiTags('admin-qna')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/qna')
export class AdminQnaController {
  constructor(private readonly qna: QnaService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.qna.adminList(status);
  }

  @Post('questions/:id/hide')
  hideQuestion(
    @CurrentUser() u: RequestUser,
    @Param('id') id: string,
    @Body() dto: AdminHideQnaDto,
    @Req() req: Request,
  ) {
    return this.qna.adminHideQuestion(id, dto, actor(u, req));
  }

  @Post('questions/:id/unhide')
  unhideQuestion(@CurrentUser() u: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.qna.adminUnhideQuestion(id, actor(u, req));
  }

  @Post('answers/:id/hide')
  hideAnswer(
    @CurrentUser() u: RequestUser,
    @Param('id') id: string,
    @Body() dto: AdminHideQnaDto,
    @Req() req: Request,
  ) {
    return this.qna.adminHideAnswer(id, dto, actor(u, req));
  }

  @Post('answers/:id/unhide')
  unhideAnswer(@CurrentUser() u: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.qna.adminUnhideAnswer(id, actor(u, req));
  }
}
