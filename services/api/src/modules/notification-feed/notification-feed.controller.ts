import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { NotificationFeedService } from './notification-feed.service';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationFeedController {
  constructor(private readonly svc: NotificationFeedService) {}

  @Get()
  async list(
    @CurrentUser() u: RequestUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    const r = await this.svc.list({
      userId: u.userId,
      cursor,
      limit: limit ? Number(limit) : undefined,
      unreadOnly: unreadOnly === 'true',
    });
    return {
      rows: r.rows.map((row) => this.svc.toApi(row)),
      nextCursor: r.nextCursor,
    };
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() u: RequestUser) {
    return { count: await this.svc.unreadCount(u.userId) };
  }

  @Post(':id/read')
  markRead(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.svc.markRead(u.userId, id);
  }

  @Post('read-all')
  markAllRead(@CurrentUser() u: RequestUser) {
    return this.svc.markAllRead(u.userId);
  }
}
