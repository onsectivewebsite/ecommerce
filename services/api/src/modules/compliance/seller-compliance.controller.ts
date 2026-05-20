import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser, type RequestUser } from '../../common/current-user.decorator';
import { CategoryRulesService } from './category-rules.service';
import { SellerDocsService } from './seller-docs.service';
import { UploadComplianceDocDto } from './dto';

@ApiTags('seller-compliance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SELLER', 'ADMIN')
@Controller('seller/compliance')
export class SellerComplianceController {
  constructor(
    private readonly rules: CategoryRulesService,
    private readonly docs: SellerDocsService,
  ) {}

  @Get('rules')
  rules_list() {
    return this.rules.list();
  }

  @Get('docs')
  myDocs(@CurrentUser() u: RequestUser) {
    return this.docs.listMine(u.userId);
  }

  @Post('docs')
  upload(@CurrentUser() u: RequestUser, @Body() dto: UploadComplianceDocDto) {
    return this.docs.upload(u.userId, dto);
  }
}
