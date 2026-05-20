import {
  Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { IsArray, IsEnum, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { WarehouseStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { WarehousesService } from './warehouses.service';

class ZoneDto {
  @IsString() @Length(2, 2) country!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) regions?: string[];
}

class CreateWarehouseDto {
  @IsString() @Length(2, 40) code!: string;
  @IsString() @Length(2, 120) displayName!: string;
  @IsString() line1!: string;
  @IsString() city!: string;
  @IsString() region!: string;
  @IsString() postalCode!: string;
  @IsString() @Length(2, 2) country!: string;
  @IsOptional() @IsInt() @Min(0) priority?: number;
  @IsOptional() @IsArray() zones?: ZoneDto[];
}

class UpdateWarehouseDto {
  @IsOptional() @IsString() displayName?: string;
  @IsOptional() @IsEnum(WarehouseStatus) status?: WarehouseStatus;
  @IsOptional() @IsInt() @Min(0) priority?: number;
}

class AddZoneDto {
  @IsString() @Length(2, 2) country!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) regions?: string[];
}

function actor(u: RequestUser, req: Request) {
  return { userId: u.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined };
}

@ApiTags('warehouses')
@Controller('warehouses')
export class WarehousesPublicController {
  constructor(private readonly svc: WarehousesService) {}

  @Get()
  list() { return this.svc.publicList(); }
}

@ApiTags('admin-warehouses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/warehouses')
export class AdminWarehousesController {
  constructor(private readonly svc: WarehousesService) {}

  @Get()
  list() { return this.svc.list(); }

  @Post()
  create(@CurrentUser() u: RequestUser, @Body() dto: CreateWarehouseDto, @Req() req: Request) {
    return this.svc.create(dto, actor(u, req));
  }

  @Patch(':id')
  update(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body() dto: UpdateWarehouseDto, @Req() req: Request) {
    return this.svc.update(id, dto, actor(u, req));
  }

  @Post(':id/zones')
  addZone(@CurrentUser() u: RequestUser, @Param('id') warehouseId: string, @Body() dto: AddZoneDto, @Req() req: Request) {
    return this.svc.addZone(warehouseId, dto.country, dto.regions ?? [], actor(u, req));
  }

  @Delete(':id/zones/:zoneId')
  removeZone(@CurrentUser() u: RequestUser, @Param('zoneId') zoneId: string, @Req() req: Request) {
    return this.svc.removeZone(zoneId, actor(u, req));
  }
}
