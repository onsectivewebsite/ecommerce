import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';
import io, { type Socket } from 'socket.io-client';
import { Screen } from '../components/Screen';
import { Card, CardDescription, CardTitle } from '../components/Card';
import { Money } from '../components/Money';
import { api } from '../lib/api';
import { API_URL } from '../lib/env';
import { colors, spacing } from '../lib/theme';
import type { OrderDto } from '@onsective/shared-types';
import type { OrdersStackParamList } from '../navigation/types';

type Rt = RouteProp<OrdersStackParamList, 'Order'>;

interface TrackingEvent {
  code: string;
  label: string;
  description?: string;
  locationCity?: string;
  locationCountry?: string;
  occurredAt: string;
}

export function OrderScreen() {
  const route = useRoute<Rt>();
  const orderId = route.params.orderId;
  const [order, setOrder] = React.useState<OrderDto | null>(null);
  const [events, setEvents] = React.useState<TrackingEvent[]>([]);

  React.useEffect(() => {
    api.orders.get(orderId).then(setOrder).catch(() => setOrder(null));
  }, [orderId]);

  // Live tracking on the default Socket.IO namespace. We subscribe with the
  // shipment's public token; the gateway joins us to `shipment:<id>` and pushes
  // event arrays every time `shipment.updated` fires backend-side.
  React.useEffect(() => {
    if (!order?.shipment?.publicToken) return;
    const socket: Socket = io(API_URL, { transports: ['websocket'] });
    socket.emit('track:subscribe', { publicToken: order.shipment.publicToken });
    socket.on('shipment:update', (payload: { events: TrackingEvent[] }) => {
      if (payload?.events) setEvents(payload.events);
    });
    return () => { socket.disconnect(); };
  }, [order?.shipment?.publicToken]);

  if (!order) return <Screen><Text style={{ color: colors.ink[400] }}>Loading…</Text></Screen>;

  return (
    <Screen>
      <Card>
        <CardTitle>Order #{order.id.slice(-8)}</CardTitle>
        <CardDescription>{order.status} · {new Date(order.createdAt).toLocaleString()}</CardDescription>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md }}>
          <Text style={{ color: colors.ink[200] }}>Total</Text>
          <Money emphasized amountMinor={order.totalMinor} currency={order.currency} />
        </View>
      </Card>

      <Card>
        <CardTitle>Items</CardTitle>
        {order.items.map((it) => (
          <View key={it.id} style={styles.itemRow}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.ink[50] }}>{it.productTitleSnapshot}</Text>
              <Text style={{ color: colors.ink[400], fontSize: 12 }}>{it.variantNameSnapshot} · qty {it.qty}</Text>
            </View>
            <Money amountMinor={it.lineSubtotalMinor} currency={order.currency} />
          </View>
        ))}
      </Card>

      {order.shipment && (
        <Card>
          <CardTitle>Tracking</CardTitle>
          <CardDescription>
            {order.shipment.carrierCode.toUpperCase()} · {order.shipment.serviceLevel}
            {order.shipment.trackingNumber ? ` · ${order.shipment.trackingNumber}` : ''}
          </CardDescription>
          {events.length === 0 ? (
            <Text style={{ color: colors.ink[400], marginTop: spacing.sm }}>
              We'll update this in real time as the carrier scans your parcel.
            </Text>
          ) : (
            events.map((e, idx) => (
              <View key={`${e.code}-${idx}`} style={styles.eventRow}>
                <View style={styles.dot} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.ink[50] }}>{e.label}</Text>
                  <Text style={{ color: colors.ink[400], fontSize: 12 }}>
                    {new Date(e.occurredAt).toLocaleString()}
                    {e.locationCity ? ` · ${e.locationCity}` : ''}
                    {e.locationCountry ? `, ${e.locationCountry}` : ''}
                  </Text>
                </View>
              </View>
            ))
          )}
        </Card>
      )}

      <Card>
        <CardTitle>Ship to</CardTitle>
        <Text style={{ color: colors.ink[200] }}>
          {order.shippingAddress.fullName}{'\n'}
          {order.shippingAddress.line1}{order.shippingAddress.line2 ? `\n${order.shippingAddress.line2}` : ''}{'\n'}
          {order.shippingAddress.city}, {order.shippingAddress.region} {order.shippingAddress.postalCode}{'\n'}
          {order.shippingAddress.country}
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.md },
  eventRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: spacing.sm, gap: spacing.md },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent[500], marginTop: 6 },
});
