import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { NotificationsService } from './notifications.service';

const PLATFORMS = ['IOS', 'ANDROID', 'WEB'] as const;

class RegisterDeviceDto {
  @IsString() @Length(20, 256)
  expoPushToken!: string;

  @IsIn(PLATFORMS as unknown as string[])
  platform!: 'IOS' | 'ANDROID' | 'WEB';

  @IsOptional() @IsString() @Length(0, 80)
  deviceModel?: string;

  @IsOptional() @IsString() @Length(0, 40)
  appVersion?: string;

  @IsOptional() @IsString() @Length(2, 8)
  locale?: string;
}

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('devices')
  register(@CurrentUser() u: RequestUser, @Body() dto: RegisterDeviceDto) {
    return this.notifications.registerDevice({ userId: u.userId, ...dto });
  }

  @Get('devices')
  list(@CurrentUser() u: RequestUser) {
    return this.notifications.listForUser(u.userId);
  }

  @Delete('devices/:id')
  unregister(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.notifications.unregister(u.userId, id);
  }
}
