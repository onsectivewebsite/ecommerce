import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
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
import { ShippingService } from './shipping.service';
import { CarrierRegistry } from './carriers/registry';
import { MilestoneDto, QuoteRequestDto } from './dto';
import type { CarrierCode } from './carriers/types';

@ApiTags('shipping')
@Controller('shipping')
export class ShippingController {
  constructor(
    private readonly shipping: ShippingService,
    private readonly registry: CarrierRegistry,
  ) {}

  // ----- buyer -----

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('quote')
  quote(@CurrentUser() u: RequestUser, @Body() dto: QuoteRequestDto) {
    return this.shipping.quoteForBuyerCart(u.userId, dto.shippingAddressId);
  }

  // ----- public buyer tracking -----

  @Get('public/:token')
  publicTrack(@Param('token') token: string) {
    return this.shipping.getByPublicToken(token);
  }

  // ----- seller / admin / shipper view -----

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  get(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.shipping.getById(id, u);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get(':id/label-url')
  labelUrl(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.shipping.getLabelDownloadUrl(id, u).then((url) => ({ url }));
  }

  // ----- shipper portal -----

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SHIPPER', 'ADMIN')
  @Get('partner/pending')
  pending() {
    return this.shipping.listPendingShipments();
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SHIPPER', 'ADMIN')
  @Patch(':id/milestone')
  milestone(@Param('id') id: string, @Body() dto: MilestoneDto) {
    return this.shipping.recordMilestone(id, dto, 'PARTNER');
  }

  // ----- carrier webhook -----

  @Post('webhook/:carrier')
  @HttpCode(200)
  async webhook(@Param('carrier') carrier: CarrierCode, @Req() req: Request) {
    const adapter = this.registry.byCode(carrier);
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const events = adapter.parseWebhook(raw, req.headers as Record<string, string | string[] | undefined>);
    if (events.length === 0) return { ok: true, ignored: true };
    // Look up shipment by tracking number
    for (const evt of events) {
      const shipment = await this.shipping['prisma'].shipment.findFirst({ where: { trackingNumber: evt.trackingNumber } });
      if (shipment) await this.shipping.ingestNormalizedEvents(shipment.id, [evt]);
    }
    return { ok: true };
  }

  // ----- carrier list (used by checkout UI) -----

  @Get('carriers')
  carriers() {
    return this.registry.all().map((a) => ({ code: a.code, displayName: a.displayName, live: a.isLive() }));
  }

  // ----- seller carrier configs -----

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SELLER', 'ADMIN')
  @Get('seller/carriers')
  async sellerCarriers(@CurrentUser() u: RequestUser) {
    const seller = await this.shipping['prisma'].seller.findUnique({ where: { userId: u.userId } });
    if (!seller) return [];
    return this.shipping['prisma'].carrierConfig.findMany({
      where: { sellerId: seller.id },
      include: { carrier: true },
      orderBy: { carrierCode: 'asc' },
    });
  }

  // ----- admin shipping rules -----

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('admin/rules')
  listRules(@Query('sellerId') sellerId?: string) {
    return this.shipping['prisma'].shippingRule.findMany({
      where: sellerId ? { sellerId } : undefined,
      orderBy: [{ sellerId: 'asc' }, { priority: 'asc' }],
    });
  }
}
