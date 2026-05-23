import * as Linking from 'expo-linking';
import type { LinkingOptions } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/types';

/**
 * Deep + universal link config.
 *
 * - `onsective://p/<slug>` and `https://shop.itsnottechy.cloud/p/<slug>` → ProductScreen.
 * - `onsective://orders/<id>` and `https://shop.itsnottechy.cloud/orders/<id>` → OrderScreen.
 * - push notifications include `data: { screen: 'Order', orderId }` which the
 *   `getInitialURL`/`getStateFromPath` fallbacks pick up via the data layer.
 */
export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [
    Linking.createURL('/'),                  // onsective://
    'https://shop.itsnottechy.cloud',
  ],
  config: {
    screens: {
      Onboarding: 'onboarding',
      Auth: {
        screens: {
          Login: 'login',
          Register: 'register',
        },
      },
      Main: {
        screens: {
          HomeTab: {
            screens: {
              Home: '',
              Search: 'search',
              Product: 'p/:slug',
            },
          },
          CartTab: { screens: { Cart: 'cart', Checkout: 'checkout', OrderConfirm: 'confirm/:orderId' } },
          OrdersTab: { screens: { Orders: 'orders', Order: 'orders/:orderId' } },
          AccountTab: { screens: { Account: 'account' } },
        },
      },
    },
  },
};
