import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { UsersService } from './users.service';
import { CreateAddressDto } from './dto';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users/me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('addresses')
  list(@CurrentUser() u: RequestUser) {
    return this.users.listAddresses(u.userId);
  }

  @Post('addresses')
  create(@CurrentUser() u: RequestUser, @Body() dto: CreateAddressDto) {
    return this.users.createAddress(u.userId, dto);
  }
}
