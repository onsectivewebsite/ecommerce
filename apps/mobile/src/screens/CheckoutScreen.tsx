import React from 'react';
import { Alert, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  initStripe,
  initPaymentSheet,
  presentPaymentSheet,
  type PaymentSheet,
} from '@stripe/stripe-react-native';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { Card, CardDescription, CardTitle } from '../components/Card';
import { Money } from '../components/Money';
import { api } from '../lib/api';
import { useCart } from '../lib/cart-context';
import { useAuth } from '../lib/auth-context';
import { APPLE_MERCHANT_ID, STRIPE_PUBLISHABLE_KEY } from '../lib/env';
import { colors, radii, spacing } from '../lib/theme';
import type { AddressDto } from '@onsective/shared-types';
import type { CartStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CartStackParamList, 'Checkout'>;

export function CheckoutScreen() {
  const nav = useNavigation<Nav>();
  const { user } = useAuth();
  const { cart, reload } = useCart();
  const [addresses, setAddresses] = React.useState<AddressDto[]>([]);
  const [shippingId, setShippingId] = React.useState<string>('');
  const [busy, setBusy] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [newAddr, setNewAddr] = React.useState({ fullName: '', line1: '', city: '', region: '', postalCode: '', country: 'US' });

  React.useEffect(() => {
    if (STRIPE_PUBLISHABLE_KEY) {
      initStripe({
        publishableKey: STRIPE_PUBLISHABLE_KEY,
        merchantIdentifier: APPLE_MERCHANT_ID,
        urlScheme: 'onsective',
      }).catch(() => undefined);
    }
    api.orders.listMyAddresses().then((rows) => {
      setAddresses(rows);
      const def = rows.find((r) => r.isDefault) ?? rows[0];
      if (def) setShippingId(def.id);
    }).catch(() => setAddresses([]));
  }, []);

  if (!user || !cart) return <Screen><Text style={{ color: colors.ink[400] }}>Loading…</Text></Screen>;

  async function placeOrder(provider: 'mock' | 'stripe') {
    if (!shippingId) { Alert.alert('Add a shipping address first'); return; }
    setBusy(true);
    try {
      const order = await api.orders.checkout({
        shippingAddressId: shippingId,
        paymentProvider: provider,
      });

      if (provider === 'mock') {
        await api.orders.mockCapture(order.id);
        await reload();
        nav.replace('OrderConfirm', { orderId: order.id });
        return;
      }

      const clientSecret = order.payment?.clientSecret;
      if (!clientSecret) throw new Error('Missing Stripe client secret');
      const init: PaymentSheet.SetupParams = {
        merchantDisplayName: 'Onsective',
        paymentIntentClientSecret: clientSecret,
        applePay: { merchantCountryCode: order.shippingAddress.country },
        googlePay: {
          merchantCountryCode: order.shippingAddress.country,
          testEnv: __DEV__,
          currencyCode: order.currency,
        },
        allowsDelayedPaymentMethods: false,
        returnURL: 'onsective://stripe-redirect',
      };
      const { error: initErr } = await initPaymentSheet(init);
      if (initErr) throw new Error(initErr.message);
      const { error: payErr } = await presentPaymentSheet();
      if (payErr) {
        if (payErr.code === 'Canceled') return;
        throw new Error(payErr.message);
      }
      await reload();
      nav.replace('OrderConfirm', { orderId: order.id });
    } catch (e) {
      Alert.alert('Checkout failed', e instanceof Error ? e.message : 'Try again');
    } finally { setBusy(false); }
  }

  async function saveAddress() {
    setBusy(true);
    try {
      const created = await api.orders.createAddress({
        fullName: newAddr.fullName, line1: newAddr.line1, city: newAddr.city,
        region: newAddr.region, postalCode: newAddr.postalCode, country: newAddr.country.toUpperCase(),
      });
      setAddresses((prev) => [...prev, created]);
      setShippingId(created.id);
      setAdding(false);
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Try again');
    } finally { setBusy(false); }
  }

  const walletLabel = Platform.OS === 'ios' ? 'Pay with Apple Pay' : 'Pay with Google Pay';

  return (
    <Screen>
      <Card>
        <CardTitle>Shipping</CardTitle>
        <CardDescription>Where should we deliver this order?</CardDescription>
        {addresses.length === 0 && !adding && (
          <Text style={{ color: colors.ink[400], marginTop: spacing.sm }}>No saved addresses.</Text>
        )}
        <View style={{ marginTop: spacing.sm }}>
          {addresses.map((a) => (
            <View
              key={a.id}
              onTouchEnd={() => setShippingId(a.id)}
              style={[
                styles.addr,
                shippingId === a.id && { borderColor: colors.accent[500], backgroundColor: 'rgba(203,108,42,0.08)' },
              ]}
            >
              <Text style={{ color: colors.ink[50], fontWeight: '600' }}>{a.fullName}</Text>
              <Text style={{ color: colors.ink[300], marginTop: 2 }}>
                {a.line1}, {a.city}, {a.region} {a.postalCode}, {a.country}
              </Text>
            </View>
          ))}
        </View>
        {adding ? (
          <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
            {(['fullName','line1','city','region','postalCode','country'] as const).map((k) => (
              <TextInput
                key={k}
                placeholder={k}
                placeholderTextColor={colors.ink[400]}
                value={newAddr[k]}
                onChangeText={(v) => setNewAddr({ ...newAddr, [k]: v })}
                style={styles.input}
              />
            ))}
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Button title="Save" onPress={saveAddress} loading={busy} />
              <Button title="Cancel" variant="ghost" onPress={() => setAdding(false)} />
            </View>
          </View>
        ) : (
          <View style={{ marginTop: spacing.sm }}>
            <Button title="+ Add address" variant="secondary" onPress={() => setAdding(true)} />
          </View>
        )}
      </Card>

      <Card>
        <CardTitle>Order summary</CardTitle>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: colors.ink[200] }}>Subtotal</Text>
          <Money emphasized amountMinor={cart.subtotalMinor} currency={cart.currency} />
        </View>
      </Card>

      <Button title={walletLabel} block loading={busy} onPress={() => placeOrder('stripe')} />
      <View style={{ height: spacing.sm }} />
      <Button title="Pay with test card (mock)" variant="secondary" block loading={busy} onPress={() => placeOrder('mock')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  addr: {
    borderColor: colors.ink[700], borderWidth: 1, borderRadius: radii.md,
    padding: spacing.md, marginBottom: spacing.sm, backgroundColor: colors.ink[900],
  },
  input: {
    color: colors.ink[50],
    backgroundColor: colors.ink[900],
    borderColor: colors.ink[800], borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md, height: 44,
  },
});
