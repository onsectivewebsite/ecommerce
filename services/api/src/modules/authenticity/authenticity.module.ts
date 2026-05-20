import { Global, Module } from '@nestjs/common';
import { AuthenticityService } from './authenticity.service';
import { AdminAuthenticityController, WarehouseAuthenticityController } from './authenticity.controller';

@Global()
@Module({
  controllers: [WarehouseAuthenticityController, AdminAuthenticityController],
  providers: [AuthenticityService],
  exports: [AuthenticityService],
})
export class AuthenticityModule {}
