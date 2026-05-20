import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { SupportService } from './support.service';
import { EscalateDto, InternalNoteDto, PlatformRefundDto } from './dto';

function actor(u: RequestUser, req: Request) {
  return { userId: u.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined };
}

@ApiTags('admin-support')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get('inbox')
  inbox(@Query('filter') filter?: 'escalated' | 'past_sla' | 'all') {
    return this.support.inbox(filter);
  }

  @Get('threads/:threadId')
  thread(@Param('threadId') threadId: string) {
    return this.support.getThreadFull(threadId);
  }

  @Post('threads/:threadId/note')
  note(@CurrentUser() u: RequestUser, @Param('threadId') threadId: string, @Body() dto: InternalNoteDto, @Req() req: Request) {
    return this.support.addInternalNote(threadId, dto, actor(u, req));
  }

  @Post('threads/:threadId/escalate')
  escalate(@CurrentUser() u: RequestUser, @Param('threadId') threadId: string, @Body() dto: EscalateDto, @Req() req: Request) {
    return this.support.escalate(threadId, dto, actor(u, req));
  }

  @Post('threads/:threadId/resolve')
  resolve(@CurrentUser() u: RequestUser, @Param('threadId') threadId: string, @Req() req: Request) {
    return this.support.resolve(threadId, actor(u, req));
  }

  @Post('threads/:threadId/platform-refund')
  refund(@CurrentUser() u: RequestUser, @Param('threadId') threadId: string, @Body() dto: PlatformRefundDto, @Req() req: Request) {
    return this.support.platformRefund(threadId, dto, actor(u, req));
  }
}
