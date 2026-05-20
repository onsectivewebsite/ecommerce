import React from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen } from '../components/Screen';
import { Money } from '../components/Money';
import { Button } from '../components/Button';
import { Card, CardDescription, CardTitle } from '../components/Card';
import { useCart } from '../lib/cart-context';
import { useAuth } from '../lib/auth-context';
import { colors, radii, spacing } from '../lib/theme';
import type { CartStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CartStackParamList, 'Cart'>;

export function CartScreen() {
  const nav = useNavigation<Nav>();
  const { user } = useAuth();
  const { cart, loading, updateItem, removeItem } = useCart();

  if (!user) {
    return (
      <Screen>
        <Card>
          <CardTitle>Sign in to start shopping</CardTitle>
          <CardDescription>Your cart will live across all your devices.</CardDescription>
        </Card>
      </Screen>
    );
  }
  if (loading) return <Screen><Text style={{ color: colors.ink[400] }}>Loading…</Text></Screen>;
  if (!cart || cart.items.length === 0) {
    return (
      <Screen>
        <Card>
          <CardTitle>Your cart is empty</CardTitle>
          <CardDescription>Add a few things from the Home tab.</CardDescription>
        </Card>
      </Screen>
    );
  }

  async function bump(itemId: string, currentQty: number, delta: number) {
    const next = Math.max(0, currentQty + delta);
    try { await updateItem(itemId, next); }
    catch (e) { Alert.alert('Could not update', e instanceof Error ? e.message : 'Try again'); }
  }

  return (
    <Screen>
      {cart.items.map((it) => (
        <View key={it.id} style={styles.row}>
          {it.imageUrl
            ? <Image source={{ uri: it.imageUrl }} style={styles.thumb} />
            : <View style={[styles.thumb, { backgroundColor: colors.ink[800] }]} />}
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: colors.ink[50], fontSize: 15, fontWeight: '500' }}>{it.productTitle}</Text>
            <Text style={{ color: colors.ink[400], fontSize: 12 }}>{it.variantName}</Text>
            <Money amountMinor={it.lineSubtotalMinor} currency={cart.currency} />
            <View style={styles.qtyRow}>
              <Pressable style={styles.qtyBtn} onPress={() => bump(it.id, it.qty, -1)}><Text style={styles.qtyText}>−</Text></Pressable>
              <Text style={{ color: colors.ink[50], minWidth: 18, textAlign: 'center' }}>{it.qty}</Text>
              <Pressable style={styles.qtyBtn} onPress={() => bump(it.id, it.qty, +1)}><Text style={styles.qtyText}>+</Text></Pressable>
              <Pressable style={[styles.qtyBtn, { marginLeft: spacing.md }]} onPress={() => removeItem(it.id)}>
                <Text style={{ color: colors.danger }}>Remove</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ))}
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: colors.ink[200] }}>Subtotal</Text>
          <Money emphasized amountMinor={cart.subtotalMinor} currency={cart.currency} />
        </View>
      </Card>
      <Button title="Checkout" block onPress={() => nav.navigate('Checkout')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', gap: spacing.md,
    backgroundColor: colors.ink[900],
    borderColor: colors.ink[800], borderWidth: 1, borderRadius: radii.md,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  thumb: { width: 64, height: 64, borderRadius: radii.sm },
  qtyRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs, gap: spacing.sm },
  qtyBtn: {
    width: 32, height: 32, borderRadius: radii.sm,
    backgroundColor: colors.ink[800],
    alignItems: 'center', justifyContent: 'center',
  },
  qtyText: { color: colors.ink[50], fontSize: 17, fontWeight: '600' },
});
