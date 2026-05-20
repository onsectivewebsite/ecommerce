import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { TradeInService } from './trade-in.service';
import {
  AcceptQuoteDto,
  CreateTradeInModelDto,
  GradingDto,
  IntakeDto,
  QuoteRequestDto,
} from './dto';

function actor(u: RequestUser, req: Request) {
  return {
    userId: u.userId,
    ip: req.ip,
    userAgent: req.headers['user-agent'] as string | undefined,
  };
}

@ApiTags('trade-in-public')
@Controller('trade-in')
export class TradeInPublicController {
  constructor(private readonly svc: TradeInService) {}

  @Post('quotes')
  quote(@Body() dto: QuoteRequestDto) {
    return this.svc.quote(dto);
  }
}

@ApiTags('trade-in-buyer')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('trade-in/orders')
export class TradeInBuyerController {
  constructor(private readonly svc: TradeInService) {}

  @Get()
  mine(@CurrentUser() u: RequestUser) {
    return this.svc.listMine(u.userId);
  }

  @Post()
  accept(
    @CurrentUser() u: RequestUser,
    @Body() dto: AcceptQuoteDto,
    @Req() req: Request,
  ) {
    return this.svc.acceptQuote(u.userId, dto, actor(u, req));
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() u: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.svc.cancel(u.userId, id, actor(u, req));
  }
}

@ApiTags('trade-in-warehouse')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SHIPPER')
@Controller('warehouse/trade-in')
export class TradeInWarehouseController {
  constructor(private readonly svc: TradeInService) {}

  @Get('queue')
  queue(@Query('warehouseId') warehouseId?: string) {
    return this.svc.intakeQueue(warehouseId);
  }

  @Post('intake')
  intake(@CurrentUser() u: RequestUser, @Body() dto: IntakeDto, @Req() req: Request) {
    return this.svc.recordIntake(dto, actor(u, req));
  }

  @Post('grade')
  grade(@CurrentUser() u: RequestUser, @Body() dto: GradingDto, @Req() req: Request) {
    return this.svc.grade(dto, actor(u, req));
  }
}

@ApiTags('trade-in-admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/trade-in')
export class TradeInAdminController {
  constructor(private readonly svc: TradeInService) {}

  @Get('models')
  models() {
    return this.svc.listModels();
  }

  @Post('models')
  createModel(@CurrentUser() u: RequestUser, @Body() dto: CreateTradeInModelDto, @Req() req: Request) {
    return this.svc.createModel(dto, actor(u, req));
  }
}
