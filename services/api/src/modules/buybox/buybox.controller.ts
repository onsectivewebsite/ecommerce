import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BuyBoxService } from './buybox.service';

@ApiTags('buybox')
@Controller('buybox')
export class BuyBoxController {
  constructor(private readonly svc: BuyBoxService) {}

  /** Public — PDP fetches this to decide which listing the CTA targets. */
  @Get(':productId')
  winnerFor(@Param('productId') productId: string) {
    return this.svc.winnerFor(productId);
  }
}
