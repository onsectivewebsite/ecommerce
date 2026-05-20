import { Global, Module } from '@nestjs/common';
import { AdminRiskController } from './risk.controller';
import { RiskEngine, RISK_RULES } from './risk.engine';
import { RiskService } from './risk.service';
import {
  CountryMismatchRule,
  NewAccountHighValueRule,
  SellerHealthAmplifierRule,
  VelocityOrdersRule,
  VelocityPaymentsRule,
} from './rules';
import type { RiskRule } from './risk.types';

const RULE_PROVIDERS = [
  VelocityOrdersRule,
  VelocityPaymentsRule,
  CountryMismatchRule,
  NewAccountHighValueRule,
  SellerHealthAmplifierRule,
];

@Global()
@Module({
  controllers: [AdminRiskController],
  providers: [
    RiskEngine,
    RiskService,
    ...RULE_PROVIDERS,
    {
      provide: RISK_RULES,
      inject: RULE_PROVIDERS,
      useFactory: (...rules: RiskRule[]) => rules,
    },
  ],
  exports: [RiskEngine, RiskService],
})
export class RiskModule {}
