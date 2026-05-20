import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { TraceMiddleware } from './trace.middleware';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, TraceMiddleware],
  exports: [MetricsService],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TraceMiddleware).forRoutes('*');
  }
}
