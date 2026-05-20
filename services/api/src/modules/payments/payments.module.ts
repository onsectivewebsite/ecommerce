import { Global, Module, type Provider } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { MockPaymentProvider } from './mock.provider';
import { StripePaymentProvider } from './stripe.provider';
import { PaymentMethodsService } from './payment-methods.service';
import { PaymentMethodsController } from './payment-methods.controller';
import { PAYMENT_GATEWAYS } from './gateway';

const gatewaysProvider: Provider = {
  provide: PAYMENT_GATEWAYS,
  useFactory: (mock: MockPaymentProvider, stripe: StripePaymentProvider) => [mock, stripe],
  inject: [MockPaymentProvider, StripePaymentProvider],
};

@Global()
@Module({
  providers: [
    MockPaymentProvider,
    StripePaymentProvider,
    gatewaysProvider,
    PaymentsService,
    PaymentMethodsService,
  ],
  controllers: [PaymentsController, PaymentMethodsController],
  exports: [PaymentsService, PaymentMethodsService, StripePaymentProvider],
})
export class PaymentsModule {}
