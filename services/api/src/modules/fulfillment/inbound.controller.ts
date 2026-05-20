import {
  Body, Controller, Get, Param, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Length, Min,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { InboundService } from './inbound.service';

class InboundItemDto {
  @IsString() variantId!: string;
  @IsInt() @Min(1) expectedQty!: number;
}

class CreateInboundDto {
  @IsString() warehouseId!: string;
  @IsOptional() @IsString() carrierCode?: string;
  @IsOptional() @IsString() trackingNumber?: string;
  @IsOptional() @IsString() @Length(0, 500) note?: string;
  @IsArray() @ArrayMinSize(1)
  items!: InboundItemDto[];
}

class MarkShippedDto {
  @IsString() carrierCode!: string;
  @IsString() trackingNumber!: string;
}

class ReceiveLineDto {
  @IsString() variantId!: string;
  @IsInt() @Min(0) receivedQty!: number;
  @IsOptional() @IsInt() discrepancyQty?: number;
}

class ReceiveDto {
  @IsArray() lines!: ReceiveLineDto[];
}

function actor(u: RequestUser, req: Request) {
  return { userId: u.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined };
}

@ApiTags('seller-inbound')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER', 'ADMIN')
@Controller('seller/inbound')
export class SellerInboundController {
  constructor(private readonly svc: InboundService) {}

  @Get()
  list(@CurrentUser() u: RequestUser, @Query('status') status?: string) {
    return this.svc.listForSeller(u.userId, status);
  }

  @Post()
  create(@CurrentUser() u: RequestUser, @Body() dto: CreateInboundDto, @Req() req: Request) {
    return this.svc.create(u.userId, dto, actor(u, req));
  }

  @Post(':id/ship')
  ship(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body() dto: MarkShippedDto, @Req() req: Request) {
    return this.svc.markShipped(u.userId, id, dto, actor(u, req));
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() u: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.svc.cancel(u.userId, id, actor(u, req));
  }
}

@ApiTags('warehouse-inbound')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SHIPPER', 'ADMIN')
@Controller('warehouse/:warehouseId/inbound')
export class WarehouseInboundController {
  constructor(private readonly svc: InboundService) {}

  @Get()
  list(@Param('warehouseId') warehouseId: string, @Query('status') status?: string) {
    return this.svc.listAtWarehouse(warehouseId, status);
  }

  @Post(':id/receive')
  receive(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body() dto: ReceiveDto, @Req() req: Request) {
    return this.svc.receive(id, dto.lines, actor(u, req));
  }

  @Post(':id/close')
  close(@CurrentUser() u: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.svc.close(id, actor(u, req));
  }
}
