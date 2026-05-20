import React from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen } from '../components/Screen';
import { Money } from '../components/Money';
import { api } from '../lib/api';
import { colors, radii, spacing } from '../lib/theme';
import type { HomeStackParamList } from '../navigation/types';
import type { ProductSummaryDto } from '@onsective/shared-types';

type Nav = NativeStackNavigationProp<HomeStackParamList, 'Search'>;
type Rt = RouteProp<HomeStackParamList, 'Search'>;

export function SearchScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const initial = route.params?.q ?? '';
  const [query, setQuery] = React.useState(initial);
  const [items, setItems] = React.useState<ProductSummaryDto[]>([]);
  const [busy, setBusy] = React.useState(false);

  const run = React.useCallback((q: string) => {
    setBusy(true);
    api.catalog.listProducts({ query: q || undefined, category: q || undefined, pageSize: 30 })
      .then((r) => setItems(r.items))
      .catch(() => setItems([]))
      .finally(() => setBusy(false));
  }, []);

  React.useEffect(() => { run(initial); }, [initial, run]);

  return (
    <Screen padded={false}>
      <View style={{ padding: spacing.lg }}>
        <TextInput
          autoFocus={!initial}
          placeholder="Search…"
          placeholderTextColor={colors.ink[400]}
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          onSubmitEditing={() => run(query.trim())}
        />
      </View>
      <FlatList
        data={items}
        numColumns={2}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing['2xl'] }}
        columnWrapperStyle={{ gap: spacing.sm }}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        ListEmptyComponent={() => (
          <Text style={{ color: colors.ink[400], textAlign: 'center', marginTop: spacing.xl }}>
            {busy ? 'Searching…' : 'No matches yet.'}
          </Text>
        )}
        renderItem={({ item }) => (
          <Pressable onPress={() => nav.navigate('Product', { slug: item.slug })} style={styles.card}>
            {item.media[0]?.url ? (
              <Image source={{ uri: item.media[0].url }} style={styles.image} />
            ) : (
              <View style={[styles.image, { backgroundColor: colors.ink[800] }]} />
            )}
            <View style={{ padding: spacing.sm }}>
              <Text numberOfLines={1} style={{ color: colors.ink[50], fontSize: 14, fontWeight: '500' }}>{item.title}</Text>
              <Money amountMinor={item.basePriceMinor} currency={item.currency} />
            </View>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: {
    color: colors.ink[50],
    backgroundColor: colors.ink[900],
    borderColor: colors.ink[800],
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    height: 44,
  },
  card: {
    flex: 1,
    backgroundColor: colors.ink[900],
    borderColor: colors.ink[800],
    borderWidth: 1,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  image: { width: '100%', aspectRatio: 1 },
});
