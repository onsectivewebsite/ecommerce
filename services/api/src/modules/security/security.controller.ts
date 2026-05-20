import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { SecurityService } from './security.service';

@ApiTags('security')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('security')
export class SecurityController {
  constructor(private readonly security: SecurityService) {}

  @Get('login-events')
  loginEvents(@CurrentUser() u: RequestUser) {
    return this.security.listLoginEvents(u.userId);
  }
}
