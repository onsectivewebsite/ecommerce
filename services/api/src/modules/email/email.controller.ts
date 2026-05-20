import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { EmailService } from './email.service';

class SetPreferenceDto {
  @IsString() category!: string;
  @IsIn(['email', 'push']) channel!: 'email' | 'push';
  @IsBoolean() enabled!: boolean;
}

@ApiTags('preferences')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('preferences/notifications')
export class NotificationPreferencesController {
  constructor(private readonly email: EmailService) {}

  @Get()
  get(@CurrentUser() u: RequestUser) {
    return this.email.getPreferences(u.userId);
  }

  @Post()
  set(@CurrentUser() u: RequestUser, @Body() dto: SetPreferenceDto) {
    return this.email.setCategoryPref(u.userId, dto.category, dto.channel, dto.enabled);
  }
}
