import { Module } from '@nestjs/common';
import { CategoryRulesService } from './category-rules.service';
import { SellerDocsService } from './seller-docs.service';
import { AgeConsentService } from './age-consent.service';
import { ComplianceGateService } from './compliance-gate.service';
import { AdminComplianceController } from './admin-compliance.controller';
import { SellerComplianceController } from './seller-compliance.controller';
import { BuyerComplianceController } from './buyer-compliance.controller';

@Module({
  controllers: [
    AdminComplianceController,
    SellerComplianceController,
    BuyerComplianceController,
  ],
  providers: [
    CategoryRulesService,
    SellerDocsService,
    AgeConsentService,
    ComplianceGateService,
  ],
  exports: [
    CategoryRulesService,
    SellerDocsService,
    AgeConsentService,
    ComplianceGateService,
  ],
})
export class ComplianceModule {}
