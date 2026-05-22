import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { AutoshipService } from './autoship.service';
import { AutoshipScheduler } from './autoship.scheduler';
import { CreateSubscriptionDto, UpdateSubscriptionDto } from './dto';

@ApiTags('autoship')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('autoship')
export class AutoshipController {
  constructor(private readonly autoship: AutoshipService) {}

  @Post()
  subscribe(@CurrentUser() u: RequestUser, @Body() dto: CreateSubscriptionDto) {
    return this.autoship.subscribe(u.userId, dto);
  }

  @Get()
  list(@CurrentUser() u: RequestUser) {
    return this.autoship.listMine(u.userId);
  }

  @Get(':id')
  getOne(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.autoship.getOne(u.userId, id);
  }

  @Patch(':id')
  update(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body() dto: UpdateSubscriptionDto) {
    return this.autoship.update(u.userId, id, dto);
  }

  @Post(':id/skip')
  skip(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.autoship.skip(u.userId, id);
  }

  @Post(':id/pause')
  pause(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.autoship.pause(u.userId, id);
  }

  @Post(':id/resume')
  resume(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.autoship.resume(u.userId, id);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.autoship.cancel(u.userId, id);
  }
}

@ApiTags('admin-autoship')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/autoship')
export class AdminAutoshipController {
  constructor(private readonly scheduler: AutoshipScheduler) {}

  /** On-demand run of the due-subscription scan (dev / ops). */
  @Post('scan')
  scan() {
    return this.scheduler.scan();
  }
}
