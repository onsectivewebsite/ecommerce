import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto';

@ApiTags('announcements')
@Controller('announcements')
export class AnnouncementsPublicController {
  constructor(private readonly svc: AnnouncementsService) {}

  /** Public — no auth. The buyer-web layout fetches this on every page. */
  @Get('current')
  current() {
    return this.svc.currentActive();
  }
}

@ApiTags('announcements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('announcements')
export class AnnouncementsBuyerController {
  constructor(private readonly svc: AnnouncementsService) {}

  @Get('my-dismissals')
  myDismissals(@CurrentUser() u: RequestUser) {
    return this.svc.myDismissals(u.userId);
  }

  @Post(':id/dismiss')
  dismiss(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.svc.dismiss(u.userId, id);
  }
}

@ApiTags('admin-announcements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/announcements')
export class AdminAnnouncementsController {
  constructor(private readonly svc: AnnouncementsService) {}

  @Get()
  list() {
    return this.svc.adminList();
  }

  @Post()
  create(@Body() dto: CreateAnnouncementDto) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAnnouncementDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
