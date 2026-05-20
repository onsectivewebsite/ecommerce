import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen } from '../components/Screen';
import { Money } from '../components/Money';
import { Card, CardDescription, CardTitle } from '../components/Card';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { colors, radii, spacing } from '../lib/theme';
import type { OrderDto } from '@onsective/shared-types';
import type { OrdersStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<OrdersStackParamList, 'Orders'>;

export function OrdersScreen() {
  const nav = useNavigation<Nav>();
  const { user } = useAuth();
  const [orders, setOrders] = React.useState<OrderDto[] | null>(null);

  React.useEffect(() => {
    if (!user) { setOrders([]); return; }
    api.orders.list().then(setOrders).catch(() => setOrders([]));
  }, [user]);

  if (!user) {
    return <Screen><Card><CardTitle>Sign in to see your orders</CardTitle><CardDescription>Track packages, redownload digital goods, and more.</CardDescription></Card></Screen>;
  }
  if (!orders) return <Screen><Text style={{ color: colors.ink[400] }}>Loading…</Text></Screen>;
  if (orders.length === 0) {
    return <Screen><Card><CardTitle>No orders yet</CardTitle><CardDescription>Once you place an order it'll appear here.</CardDescription></Card></Screen>;
  }

  return (
    <Screen padded={false}>
      <FlatList
        data={orders}
        keyExtractor={(o) => o.id}
        contentContainerStyle={{ padding: spacing.lg }}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        renderItem={({ item }) => (
          <Pressable onPress={() => nav.navigate('Order', { orderId: item.id })} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.ink[50], fontWeight: '600' }}>#{item.id.slice(-8)}</Text>
              <Text style={{ color: colors.ink[400], fontSize: 12, marginTop: 2 }}>{item.status} · {new Date(item.createdAt).toLocaleDateString()}</Text>
            </View>
            <Money emphasized amountMinor={item.totalMinor} currency={item.currency} />
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center',
    padding: spacing.md, backgroundColor: colors.ink[900],
    borderColor: colors.ink[800], borderWidth: 1, borderRadius: radii.md,
  },
});
