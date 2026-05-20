import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { newId } from '../../common/id';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { UpsertTaxRuleDto } from './dto';

@ApiTags('admin-tax')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/tax')
export class AdminTaxController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('rules')
  list(@Query('kind') kind?: string) {
    return this.prisma.taxRule.findMany({
      where: kind ? { kind: kind as any } : {},
      orderBy: [{ jurisdictionCode: 'asc' }, { priority: 'asc' }],
    });
  }

  @Post('rules')
  async create(
    @CurrentUser() u: RequestUser,
    @Body() dto: UpsertTaxRuleDto,
    @Req() req: Request,
  ) {
    const row = await this.prisma.taxRule.create({
      data: {
        id: newId(),
        name: dto.name,
        kind: dto.kind,
        jurisdictionType: dto.jurisdictionType,
        jurisdictionCode: dto.jurisdictionCode.toUpperCase(),
        ratePctMicro: dto.ratePctMicro,
        includedInPrice: dto.includedInPrice ?? false,
        categorySlug: dto.categorySlug ?? null,
        priority: dto.priority ?? 100,
        enabled: dto.enabled ?? true,
        notes: dto.notes ?? null,
      },
    });
    await this.audit.record({
      actorUserId: u.userId,
      action: 'tax.rule.create',
      entityType: 'TaxRule',
      entityId: row.id,
      after: row,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return row;
  }

  @Put('rules/:id')
  async update(
    @CurrentUser() u: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpsertTaxRuleDto,
    @Req() req: Request,
  ) {
    const before = await this.prisma.taxRule.findUnique({ where: { id } });
    if (!before) return null;
    const after = await this.prisma.taxRule.update({
      where: { id },
      data: {
        name: dto.name,
        kind: dto.kind,
        jurisdictionType: dto.jurisdictionType,
        jurisdictionCode: dto.jurisdictionCode.toUpperCase(),
        ratePctMicro: dto.ratePctMicro,
        includedInPrice: dto.includedInPrice ?? false,
        categorySlug: dto.categorySlug ?? null,
        priority: dto.priority ?? 100,
        enabled: dto.enabled ?? true,
        notes: dto.notes ?? null,
      },
    });
    await this.audit.record({
      actorUserId: u.userId,
      action: 'tax.rule.update',
      entityType: 'TaxRule',
      entityId: id,
      before,
      after,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return after;
  }

  @Delete('rules/:id')
  async remove(@CurrentUser() u: RequestUser, @Param('id') id: string, @Req() req: Request) {
    const before = await this.prisma.taxRule.findUnique({ where: { id } });
    if (!before) return { ok: true };
    await this.prisma.taxRule.delete({ where: { id } });
    await this.audit.record({
      actorUserId: u.userId,
      action: 'tax.rule.delete',
      entityType: 'TaxRule',
      entityId: id,
      before,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { ok: true };
  }
}
