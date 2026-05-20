import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { UserPrefsService } from './user-prefs.service';
import { SUPPORTED_CURRENCIES, SUPPORTED_LOCALES } from './locale.constants';

class UpdatePrefsDto {
  @IsOptional() @IsString() @Length(2, 8)
  locale?: string;

  @IsOptional() @IsString() @Length(3, 3)
  currency?: string;
}

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users/me')
export class UserPrefsController {
  constructor(private readonly prefs: UserPrefsService) {}

  @Get('preferences')
  get(@CurrentUser() u: RequestUser) {
    return this.prefs.get(u.userId);
  }

  @Patch('preferences')
  update(@CurrentUser() u: RequestUser, @Body() dto: UpdatePrefsDto) {
    return this.prefs.upsert(u.userId, dto);
  }

  /** Public metadata so the buyer-web can populate switchers without hardcoding. */
  @Get('preferences/options')
  options() {
    return { locales: SUPPORTED_LOCALES, currencies: SUPPORTED_CURRENCIES };
  }
}
