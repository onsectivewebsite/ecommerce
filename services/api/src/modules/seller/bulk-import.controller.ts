import { Body, Controller, Get, Header, Headers, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { BulkImportService } from './bulk-import.service';

class BulkImportDto {
  csv!: string;
}

@ApiTags('seller-bulk')
@Controller('seller/products')
export class BulkImportController {
  constructor(private readonly bulk: BulkImportService) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SELLER', 'ADMIN')
  @Post('bulk-import')
  async import(
    @CurrentUser() u: RequestUser,
    @Body() dto: BulkImportDto,
    @Headers('x-dry-run') dryRun?: string,
  ) {
    const isDry = dryRun === '1' || dryRun === 'true';
    return this.bulk.import(u.userId, dto.csv ?? '', isDry);
  }

  @Get('bulk-import/template')
  @Header('Content-Type', 'text/csv')
  template(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Content-Disposition', 'attachment; filename="onsective-bulk-template.csv"');
    return this.bulk.template();
  }
}
