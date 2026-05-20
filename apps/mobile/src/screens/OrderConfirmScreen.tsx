import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { colors, spacing } from '../lib/theme';
import type { CartStackParamList, MainTabParamList } from '../navigation/types';

type Nav = CompositeNavigationProp<
  NativeStackNavigationProp<CartStackParamList, 'OrderConfirm'>,
  BottomTabNavigationProp<MainTabParamList>
>;
type Rt = RouteProp<CartStackParamList, 'OrderConfirm'>;

export function OrderConfirmScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const id = route.params.orderId;

  return (
    <Screen>
      <Card>
        <View style={{ alignItems: 'center', paddingVertical: spacing.lg }}>
          <Text style={{ fontSize: 36 }}>✓</Text>
          <Text style={{ color: colors.ink[50], fontSize: 22, fontWeight: '700', marginTop: spacing.sm }}>Order placed</Text>
          <Text style={{ color: colors.ink[300], marginTop: 4, fontSize: 13 }}>#{id.slice(-8)}</Text>
        </View>
      </Card>
      <Button title="View order" block onPress={() => nav.navigate('OrdersTab', { screen: 'Order', params: { orderId: id } })} />
      <View style={{ height: spacing.sm }} />
      <Button title="Keep shopping" variant="ghost" block onPress={() => nav.navigate('HomeTab', { screen: 'Home' })} />
    </Screen>
  );
}

const styles = StyleSheet.create({});
