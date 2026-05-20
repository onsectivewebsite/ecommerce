import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { CategoryRulesService } from './category-rules.service';
import { SellerDocsService } from './seller-docs.service';
import { ReviewComplianceDocDto, UpsertCategoryComplianceDto } from './dto';

@ApiTags('admin-compliance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/compliance')
export class AdminComplianceController {
  constructor(
    private readonly rules: CategoryRulesService,
    private readonly docs: SellerDocsService,
  ) {}

  @Get('rules')
  listRules() {
    return this.rules.list();
  }

  @Put('rules/:categoryId')
  upsertRule(@Param('categoryId') categoryId: string, @Body() dto: UpsertCategoryComplianceDto) {
    return this.rules.upsert(categoryId, dto);
  }

  @Delete('rules/:categoryId')
  deleteRule(@Param('categoryId') categoryId: string) {
    return this.rules.delete(categoryId).then(() => ({ ok: true }));
  }

  @Get('docs')
  listPendingDocs() {
    return this.docs.listPending();
  }

  @Get('docs/:id/view')
  async viewDoc(@Param('id') id: string, @Query('ttl') ttl?: string) {
    const url = await this.docs.getPresignedViewUrl(id, ttl ? Number(ttl) : 300);
    return { url };
  }

  @Post('docs/:id/review')
  reviewDoc(
    @CurrentUser() u: RequestUser,
    @Param('id') id: string,
    @Body() dto: ReviewComplianceDocDto,
  ) {
    return this.docs.review(u.userId, id, dto);
  }
}
