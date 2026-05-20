import { Module } from '@nestjs/common';
import { KeyCrypto } from '../digital-goods/key-crypto';
import { SellerWebhooksController } from './seller-webhooks.controller';
import { SellerWebhooksListener } from './seller-webhooks.listener';
import { SellerWebhooksScheduler } from './seller-webhooks.scheduler';
import { SellerWebhooksService } from './seller-webhooks.service';

@Module({
  controllers: [SellerWebhooksController],
  providers: [SellerWebhooksService, SellerWebhooksListener, SellerWebhooksScheduler, KeyCrypto],
  exports: [SellerWebhooksService],
})
export class SellerWebhooksModule {}
