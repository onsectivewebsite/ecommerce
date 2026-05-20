import { Module } from '@nestjs/common';
import { ExperimentsService } from './experiments.service';
import { AdminExperimentsController, ExperimentsController } from './experiments.controller';

@Module({
  controllers: [ExperimentsController, AdminExperimentsController],
  providers: [ExperimentsService],
  exports: [ExperimentsService],
})
export class ExperimentsModule {}
