import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CollectionsService } from './collections.service';
import {
  AddCollectionItemDto,
  CreateCollectionDto,
  UpdateCollectionDto,
  UpdateCollectionItemDto,
} from './dto';

@ApiTags('collections')
@Controller('collections')
export class CollectionsPublicController {
  constructor(private readonly svc: CollectionsService) {}

  @Get()
  list() {
    return this.svc.publicList();
  }

  @Get(':slug')
  bySlug(@Param('slug') slug: string) {
    return this.svc.publicGetBySlug(slug);
  }
}

@ApiTags('admin-collections')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/collections')
export class AdminCollectionsController {
  constructor(private readonly svc: CollectionsService) {}

  @Get()
  list() {
    return this.svc.adminList();
  }

  @Get(':id')
  one(@Param('id') id: string) {
    return this.svc.adminGet(id);
  }

  @Post()
  create(@Body() dto: CreateCollectionDto) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCollectionDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }

  @Post(':id/items')
  addItem(@Param('id') id: string, @Body() dto: AddCollectionItemDto) {
    return this.svc.addItem(id, dto);
  }

  @Delete(':id/items/:productId')
  removeItem(@Param('id') id: string, @Param('productId') productId: string) {
    return this.svc.removeItem(id, productId);
  }

  @Patch(':id/items/:productId')
  reorderItem(
    @Param('id') id: string,
    @Param('productId') productId: string,
    @Body() dto: UpdateCollectionItemDto,
  ) {
    return this.svc.reorderItem(id, productId, dto);
  }
}
