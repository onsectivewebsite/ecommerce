import { Global, Module } from '@nestjs/common';
import { FxService } from './fx.service';
import { FxScheduler } from './fx.scheduler';
import { FxController } from './fx.controller';

@Global()
@Module({
  controllers: [FxController],
  providers: [FxService, FxScheduler],
  exports: [FxService],
})
export class FxModule {}
