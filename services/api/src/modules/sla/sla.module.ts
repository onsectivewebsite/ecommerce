import { Global, Module } from '@nestjs/common';
import { SlaService } from './sla.service';
import { SlaBreachScheduler } from './sla-breach.scheduler';
import { AdminSlaController, SlaPublicController } from './sla.controller';

@Global()
@Module({
  controllers: [SlaPublicController, AdminSlaController],
  providers: [SlaService, SlaBreachScheduler],
  exports: [SlaService],
})
export class SlaModule {}
