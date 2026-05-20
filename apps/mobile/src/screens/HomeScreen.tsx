import React from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Screen } from '../components/Screen';
import { Money } from '../components/Money';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n-context';
import { colors, radii, spacing } from '../lib/theme';
import type { HomeStackParamList } from '../navigation/types';
import type { CategoryDto, ProductSummaryDto } from '@onsective/shared-types';

type Nav = NativeStackNavigationProp<HomeStackParamList, 'Home'>;

export function HomeScreen() {
  const nav = useNavigation<Nav>();
  const { t } = useI18n();
  const [cats, setCats] = React.useState<CategoryDto[]>([]);
  const [products, setProducts] = React.useState<ProductSummaryDto[]>([]);
  const [search, setSearch] = React.useState('');

  React.useEffect(() => {
    api.catalog.listCategories().then(setCats).catch(() => setCats([]));
    api.catalog.listProducts({ pageSize: 24 }).then((r) => setProducts(r.items)).catch(() => setProducts([]));
  }, []);

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Text style={styles.brand}>Onsective</Text>
        <Text style={styles.tag}>{t('home.heroTagline')}</Text>
        <TextInput
          placeholder={t('nav.search')}
          placeholderTextColor={colors.ink[400]}
          style={styles.search}
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={() => nav.navigate('Search', { q: search.trim() || undefined })}
          returnKeyType="search"
        />
      </View>
      <Text style={styles.sectionTitle}>{t('home.browseCategories')}</Text>
      <FlatList
        horizontal
        data={cats}
        keyExtractor={(c) => c.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: spacing.lg }}
        renderItem={({ item }) => (
          <Pressable onPress={() => nav.navigate('Search', { q: item.slug })} style={styles.chip}>
            <Text style={styles.chipText}>{item.name}</Text>
          </Pressable>
        )}
      />
      <Text style={styles.sectionTitle}>{t('home.shopAll')}</Text>
      <View style={styles.grid}>
        {products.map((p) => (
          <Pressable
            key={p.id}
            onPress={() => nav.navigate('Product', { slug: p.slug })}
            style={styles.card}
          >
            {p.media[0]?.url ? (
              <Image source={{ uri: p.media[0].url }} style={styles.cardImage} />
            ) : (
              <View style={[styles.cardImage, { backgroundColor: colors.ink[800] }]} />
            )}
            <View style={{ padding: spacing.sm }}>
              <Text numberOfLines={1} style={styles.cardTitle}>{p.title}</Text>
              <View style={{ marginTop: 2 }}>
                <Money amountMinor={p.basePriceMinor} currency={p.currency} />
              </View>
            </View>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md },
  brand: { color: colors.ink[50], fontSize: 26, fontWeight: '800' },
  tag: { color: colors.ink[300], marginTop: 2, fontSize: 13 },
  search: {
    marginTop: spacing.md,
    color: colors.ink[50],
    backgroundColor: colors.ink[900],
    borderColor: colors.ink[800],
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    height: 44,
  },
  sectionTitle: {
    color: colors.ink[100],
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.ink[900],
    borderColor: colors.ink[800],
    borderWidth: 1,
    borderRadius: radii.md,
    marginRight: spacing.sm,
  },
  chipText: { color: colors.ink[100], fontSize: 13 },
  grid: { paddingHorizontal: spacing.lg, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  card: {
    width: '48%',
    backgroundColor: colors.ink[900],
    borderColor: colors.ink[800],
    borderWidth: 1,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  cardImage: { width: '100%', aspectRatio: 1 },
  cardTitle: { color: colors.ink[50], fontSize: 14, fontWeight: '500' },
});
