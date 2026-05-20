import React from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Screen } from '../components/Screen';
import { Money } from '../components/Money';
import { Button } from '../components/Button';
import { api } from '../lib/api';
import { useCart } from '../lib/cart-context';
import { useAuth } from '../lib/auth-context';
import { colors, radii, spacing } from '../lib/theme';
import type { HomeStackParamList, MainTabParamList } from '../navigation/types';
import type { ProductDetailDto } from '@onsective/shared-types';

type Nav = CompositeNavigationProp<
  NativeStackNavigationProp<HomeStackParamList, 'Product'>,
  BottomTabNavigationProp<MainTabParamList>
>;
type Rt = RouteProp<HomeStackParamList, 'Product'>;

export function ProductScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const { user } = useAuth();
  const { addItem } = useCart();
  const [product, setProduct] = React.useState<ProductDetailDto | null>(null);
  const [variantId, setVariantId] = React.useState<string>('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    api.catalog.getProduct(route.params.slug)
      .then((p) => { setProduct(p); setVariantId(p.variants[0]?.id ?? ''); })
      .catch(() => setProduct(null));
  }, [route.params.slug]);

  if (!product) {
    return <Screen><Text style={{ color: colors.ink[400] }}>Loading…</Text></Screen>;
  }
  const variant = product.variants.find((v) => v.id === variantId) ?? product.variants[0];
  const requiresAge = !!product.compliance?.requiresAgeCheck;

  async function handleAdd(buyNow: boolean) {
    if (!user) {
      Alert.alert('Sign in required', 'Please sign in to add items to your cart.');
      return;
    }
    if (requiresAge) {
      Alert.alert('Age check required',
        `${product?.title} is restricted to buyers aged ${product?.compliance?.minBuyerAge ?? 18}+. Use the web checkout to complete age verification, then come back.`);
      return;
    }
    if (!variant) return;
    setBusy(true);
    try {
      await addItem(variant.id, 1);
      if (buyNow) nav.navigate('CartTab', { screen: 'Cart' });
    } catch (e) {
      Alert.alert('Could not add', e instanceof Error ? e.message : 'Try again');
    } finally { setBusy(false); }
  }

  return (
    <Screen>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} pagingEnabled style={{ marginHorizontal: -spacing.lg }}>
        {(product.media.length ? product.media : [{ id: 'p', url: '' }]).map((m) => (
          m.url
            ? <Image key={m.id} source={{ uri: m.url }} style={styles.hero} />
            : <View key={m.id} style={[styles.hero, { backgroundColor: colors.ink[800] }]} />
        ))}
      </ScrollView>

      <Text style={styles.seller}>{product.sellerName}</Text>
      <Text style={styles.title}>{product.title}</Text>

      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginTop: spacing.md }}>
        <Money emphasized amountMinor={variant?.priceMinor ?? product.basePriceMinor} currency={product.currency} />
        <Text style={{ color: colors.ink[400], fontSize: 12 }}>in stock: {variant?.inventoryQty ?? 0}</Text>
      </View>

      {product.variants.length > 1 && (
        <View style={{ marginTop: spacing.md, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {product.variants.map((v) => (
            <View
              key={v.id}
              style={[
                styles.variant,
                v.id === variantId && { borderColor: colors.accent[500], backgroundColor: 'rgba(203,108,42,0.12)' },
              ]}
              onTouchEnd={() => setVariantId(v.id)}
            >
              <Text style={{ color: colors.ink[50] }}>{v.name}</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={styles.desc}>{product.description}</Text>

      <View style={{ height: spacing.lg }} />
      <Button title="Add to cart" variant="secondary" block loading={busy} onPress={() => handleAdd(false)} />
      <View style={{ height: spacing.sm }} />
      <Button title="Buy now" block loading={busy} onPress={() => handleAdd(true)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { width: 360, height: 360, marginRight: 0 },
  seller: { color: colors.gold[400], marginTop: spacing.md, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase' },
  title: { color: colors.ink[50], fontSize: 26, fontWeight: '700', marginTop: 4 },
  variant: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderColor: colors.ink[700], borderWidth: 1, borderRadius: radii.sm,
    backgroundColor: colors.ink[900],
  },
  desc: { color: colors.ink[200], lineHeight: 22, marginTop: spacing.lg },
});
