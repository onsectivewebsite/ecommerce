import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { MessagingService } from './messaging.service';
import { MuteDto, PresignAttachmentDto, SendMessageDto } from './dto';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';

function actor(u: RequestUser, req: Request) {
  return { userId: u.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined };
}

@ApiTags('messaging')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('messaging')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get('threads')
  myThreads(@CurrentUser() u: RequestUser) {
    return this.messaging.listMyThreads(u.userId, u.role);
  }

  /** Buyer/seller entry point: open the per-order thread (creates if absent). */
  @Get('order/:orderId')
  threadForOrder(@CurrentUser() u: RequestUser, @Param('orderId') orderId: string) {
    return this.messaging.getOrderThread(orderId, u.userId, u.role);
  }

  @Get(':threadId')
  thread(@CurrentUser() u: RequestUser, @Param('threadId') threadId: string) {
    return this.messaging.getThread(threadId, u.userId, u.role);
  }

  @Post(':threadId/messages')
  @UseGuards(RateLimitGuard)
  @RateLimit({ rule: 'messaging.send', max: 60, windowSec: 60, scope: 'user' })
  send(
    @CurrentUser() u: RequestUser,
    @Param('threadId') threadId: string,
    @Body() dto: SendMessageDto,
    @Req() req: Request,
  ) {
    return this.messaging.sendMessage(threadId, dto, actor(u, req), u.role);
  }

  @Post(':threadId/read')
  read(@CurrentUser() u: RequestUser, @Param('threadId') threadId: string) {
    const kind = u.role === 'BUYER' ? 'BUYER' : u.role === 'SELLER' ? 'SELLER' : 'ADMIN';
    return this.messaging.markRead(threadId, kind as 'BUYER' | 'SELLER' | 'ADMIN').then(() => ({ ok: true }));
  }

  @Post(':threadId/mute')
  mute(@CurrentUser() u: RequestUser, @Param('threadId') threadId: string, @Body() dto: MuteDto) {
    return this.messaging.setMute(threadId, u.userId, u.role, dto.muted !== false);
  }

  @Post(':threadId/attachments/presign')
  presign(
    @CurrentUser() u: RequestUser,
    @Param('threadId') threadId: string,
    @Body() dto: PresignAttachmentDto,
  ) {
    // Authorize: ensure participant before issuing a signed URL.
    return this.messaging
      .assertParticipant(threadId, u.userId, u.role)
      .then(() => this.messaging.presignAttachmentUpload(threadId, dto));
  }
}
