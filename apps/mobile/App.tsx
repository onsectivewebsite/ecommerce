import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StripeProvider } from '@stripe/stripe-react-native';
import * as Notifications from 'expo-notifications';
import { AuthProvider, useAuth } from './src/lib/auth-context';
import { CartProvider } from './src/lib/cart-context';
import { I18nProvider } from './src/lib/i18n-context';
import { registerForPushAsync } from './src/lib/push';
import { linking } from './src/lib/linking';
import { RootNavigator } from './src/navigation/RootNavigator';
import { APPLE_MERCHANT_ID, STRIPE_PUBLISHABLE_KEY } from './src/lib/env';
import type { RootStackParamList } from './src/navigation/types';

function PushBridge({ navRef }: { navRef: ReturnType<typeof useNavigationContainerRef<RootStackParamList>> }) {
  const { user } = useAuth();

  // Register the device after sign-in. The backend dedupes by token so re-launches are cheap.
  React.useEffect(() => {
    if (!user) return;
    registerForPushAsync().catch(() => undefined);
  }, [user]);

  // Tap on a push → route to the right screen.
  React.useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as
        | { screen?: string; orderId?: string }
        | undefined;
      if (!data || !navRef.isReady()) return;
      if (data.screen === 'Order' && data.orderId) {
        navRef.navigate('Main', {
          screen: 'OrdersTab',
          params: { screen: 'Order', params: { orderId: data.orderId } },
        });
      }
    });
    return () => sub.remove();
  }, [navRef]);

  return null;
}

export default function App() {
  const navRef = useNavigationContainerRef<RootStackParamList>();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StripeProvider
          publishableKey={STRIPE_PUBLISHABLE_KEY || 'pk_test_placeholder'}
          merchantIdentifier={APPLE_MERCHANT_ID}
          urlScheme="onsective"
        >
          <AuthProvider>
            <I18nProvider>
              <CartProvider>
                <NavigationContainer ref={navRef} linking={linking}>
                  <StatusBar style="light" />
                  <PushBridge navRef={navRef} />
                  <RootNavigator />
                </NavigationContainer>
              </CartProvider>
            </I18nProvider>
          </AuthProvider>
        </StripeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
