import { Global, Module } from '@nestjs/common';
import { DevEmailProvider } from './dev.provider';
import { EmailListener } from './email.listener';
import { EmailService, emailProvidersFactory } from './email.service';
import { NotificationPreferencesController } from './email.controller';
import { ResendEmailProvider } from './resend.provider';

@Global()
@Module({
  controllers: [NotificationPreferencesController],
  providers: [
    DevEmailProvider,
    ResendEmailProvider,
    emailProvidersFactory,
    EmailService,
    EmailListener,
  ],
  exports: [EmailService],
})
export class EmailModule {}
