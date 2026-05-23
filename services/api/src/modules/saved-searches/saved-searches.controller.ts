import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { SavedSearchesService } from './saved-searches.service';
import { SavedSearchesScheduler } from './saved-searches.scheduler';
import { CreateSavedSearchDto } from './dto';

@ApiTags('saved-searches')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('saved-searches')
export class SavedSearchesController {
  constructor(private readonly svc: SavedSearchesService) {}

  @Get()
  list(@CurrentUser() u: RequestUser) {
    return this.svc.list(u.userId);
  }

  @Post()
  create(@CurrentUser() u: RequestUser, @Body() dto: CreateSavedSearchDto) {
    return this.svc.create(u.userId, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.svc.remove(u.userId, id);
  }
}

@ApiTags('admin-saved-searches')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/saved-searches')
export class AdminSavedSearchesController {
  constructor(private readonly scheduler: SavedSearchesScheduler) {}

  @Post('scan')
  scan() {
    return this.scheduler.scan();
  }
}
