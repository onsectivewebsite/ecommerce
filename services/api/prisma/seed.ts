import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { ulid } from 'ulid';

const prisma = new PrismaClient();

interface CategorySeed {
  slug: string;
  name: string;
  position: number;
}

const CATEGORIES: CategorySeed[] = [
  { slug: 'electronics', name: 'Electronics', position: 1 },
  { slug: 'home-living', name: 'Home & Living', position: 2 },
  { slug: 'fashion', name: 'Fashion', position: 3 },
  { slug: 'beauty', name: 'Beauty', position: 4 },
  { slug: 'books', name: 'Books', position: 5 },
  { slug: 'grocery', name: 'Grocery', position: 6 },
];

interface UserSeed {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: 'BUYER' | 'SELLER' | 'ADMIN' | 'SHIPPER';
  status?: 'ACTIVE' | 'PENDING';
}

interface UserSeedExt extends UserSeed { role: 'BUYER' | 'SELLER' | 'ADMIN' | 'SHIPPER' }

const USERS: UserSeedExt[] = [
  { email: 'admin@onsective.com',    password: 'OnsectiveAdmin1!', firstName: 'Onsective', lastName: 'Admin',    role: 'ADMIN' },
  { email: 'seller@onsective.com',   password: 'OnsectiveSell1!',  firstName: 'Sharma',     lastName: 'Stores',   role: 'SELLER' },
  { email: 'buyer@onsective.com',    password: 'OnsectiveBuy1!',   firstName: 'Aarav',      lastName: 'Mehta',    role: 'BUYER' },
  { email: 'shipper@onsective.com',  password: 'OnsectiveShip1!',  firstName: 'Logix',      lastName: 'Partner',  role: 'SHIPPER' },
];

const CARRIERS = [
  { code: 'mock',       displayName: 'Onsective Mock Carrier (dev)' },
  { code: 'fedex',      displayName: 'FedEx' },
  { code: 'ups',        displayName: 'UPS' },
  { code: 'dhl',        displayName: 'DHL Express' },
  { code: 'canadapost', displayName: 'Canada Post' },
];

const PRODUCTS = [
  {
    title: 'Aurora Wireless Earbuds',
    slug: 'aurora-wireless-earbuds',
    description:
      'Studio-grade audio in an impossibly small frame. 30-hour battery, hybrid ANC, transparent mode, IPX5.',
    categorySlug: 'electronics',
    basePriceMinor: 12900,
    media: [
      'https://images.unsplash.com/photo-1606220588913-b3aacb4d2f46?w=900',
      'https://images.unsplash.com/photo-1572569511254-d8f925fe2cbb?w=900',
    ],
    variants: [
      { sku: 'AWE-ONYX', name: 'Onyx',  priceMinor: 12900, inventoryQty: 120, weightGrams: 80 },
      { sku: 'AWE-SNOW', name: 'Snow',  priceMinor: 12900, inventoryQty: 80,  weightGrams: 80 },
      { sku: 'AWE-GOLD', name: 'Gold',  priceMinor: 13900, inventoryQty: 40,  weightGrams: 80 },
    ],
  },
  {
    title: 'Halcyon Linen Throw',
    slug: 'halcyon-linen-throw',
    description: 'Oversized 60×80" stonewashed linen throw. Made in Portugal. OEKO-TEX certified.',
    categorySlug: 'home-living',
    basePriceMinor: 8900,
    media: ['https://images.unsplash.com/photo-1493663284031-b7e3aefcae8e?w=900'],
    variants: [
      { sku: 'HLT-SAND',  name: 'Sand',  priceMinor: 8900, inventoryQty: 60, weightGrams: 1200 },
      { sku: 'HLT-OLIVE', name: 'Olive', priceMinor: 8900, inventoryQty: 45, weightGrams: 1200 },
    ],
  },
  {
    title: 'Meridian Merino Crew',
    slug: 'meridian-merino-crew',
    description: 'Ultrafine 17.5-micron merino crewneck. Temperature-regulating, naturally odor-resistant.',
    categorySlug: 'fashion',
    basePriceMinor: 11500,
    media: ['https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?w=900'],
    variants: [
      { sku: 'MMC-CHA-S', name: 'Charcoal · S', priceMinor: 11500, inventoryQty: 30, weightGrams: 320 },
      { sku: 'MMC-CHA-M', name: 'Charcoal · M', priceMinor: 11500, inventoryQty: 40, weightGrams: 340 },
      { sku: 'MMC-CHA-L', name: 'Charcoal · L', priceMinor: 11500, inventoryQty: 25, weightGrams: 360 },
    ],
  },
  {
    title: 'Verdant Cold-Pressed Serum',
    slug: 'verdant-cold-pressed-serum',
    description: 'Cold-pressed botanical serum with bakuchiol and squalane. 30 ml. Cruelty-free.',
    categorySlug: 'beauty',
    basePriceMinor: 6400,
    media: ['https://images.unsplash.com/photo-1556228720-195a672e8a03?w=900'],
    variants: [{ sku: 'VCPS-30', name: '30 ml', priceMinor: 6400, inventoryQty: 100, weightGrams: 120 }],
  },
];

async function main() {
  console.log('▶ Seeding Onsective…');

  // settings
  await prisma.adminSetting.upsert({
    where: { key: 'platform.commission.bps' },
    update: { value: '1500' },
    create: { key: 'platform.commission.bps', value: '1500', description: 'Default commission in basis points (1500 = 15%)' },
  });
  await prisma.adminSetting.upsert({
    where: { key: 'platform.flat_shipping.minor' },
    update: { value: '499' },
    create: { key: 'platform.flat_shipping.minor', value: '499', description: 'Flat shipping in minor units' },
  });
  await prisma.adminSetting.upsert({
    where: { key: 'platform.flat_tax.bps' },
    update: { value: '800' },
    create: { key: 'platform.flat_tax.bps', value: '800', description: 'Flat tax in basis points (800 = 8%)' },
  });
  await prisma.adminSetting.upsert({
    where: { key: 'platform.currency' },
    update: { value: 'USD' },
    create: { key: 'platform.currency', value: 'USD', description: 'Default platform currency' },
  });

  // categories
  for (const c of CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: c.slug },
      update: { name: c.name, position: c.position },
      create: { id: ulid(), slug: c.slug, name: c.name, position: c.position },
    });
  }

  // users
  const userMap = new Map<string, string>();
  for (const u of USERS) {
    const passwordHash = await argon2.hash(u.password);
    const existing = await prisma.user.findUnique({ where: { email: u.email } });
    if (existing) {
      userMap.set(u.email, existing.id);
      continue;
    }
    const created = await prisma.user.create({
      data: {
        id: ulid(),
        email: u.email,
        passwordHash,
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
        status: 'ACTIVE',
      },
    });
    userMap.set(u.email, created.id);
  }

  // seller profile (approved so we can seed products)
  const sellerUserId = userMap.get('seller@onsective.com')!;
  let seller = await prisma.seller.findUnique({ where: { userId: sellerUserId } });
  if (!seller) {
    seller = await prisma.seller.create({
      data: {
        id: ulid(),
        userId: sellerUserId,
        storeName: 'sharma-stores',
        displayName: 'Sharma Stores',
        status: 'APPROVED',
        payoutCurrency: 'USD',
        originName: 'Sharma Stores',
        originLine1: '17 Linking Road',
        originCity: 'Mumbai',
        originRegion: 'MH',
        originPostal: '400050',
        originCountry: 'IN',
        originPhone: '+91-9000011000',
      },
    });
  }

  // carriers + per-seller enablement
  for (const c of CARRIERS) {
    await prisma.carrier.upsert({
      where: { code: c.code },
      update: { displayName: c.displayName },
      create: { code: c.code, displayName: c.displayName, globallyEnabled: true },
    });
    const cfg = await prisma.carrierConfig.findUnique({
      where: { sellerId_carrierCode: { sellerId: seller.id, carrierCode: c.code } },
    });
    if (!cfg) {
      await prisma.carrierConfig.create({
        data: {
          id: ulid(),
          sellerId: seller.id,
          carrierCode: c.code,
          enabled: true,
          serviceLevels: c.code === 'mock'
            ? ['standard', 'express']
            : c.code === 'fedex'
              ? ['fedex_ground', 'fedex_2day', 'fedex_overnight']
              : c.code === 'ups'
                ? ['ups_ground', 'ups_3day', 'ups_next_day']
                : c.code === 'dhl'
                  ? ['dhl_express_worldwide']
                  : ['canadapost_regular', 'canadapost_expedited'],
        },
      });
    }
  }

  // Phase 3: default subscription = BASIC for the seller
  const sub = await prisma.sellerSubscription.findUnique({ where: { sellerId: seller.id } });
  if (!sub) {
    await prisma.sellerSubscription.create({
      data: {
        id: ulid(),
        sellerId: seller.id,
        tier: 'BASIC',
        status: 'ACTIVE',
      },
    });
  }

  // Phase 3: platform-wide default listing fee (zero), plus a category-specific example
  const platformFee = await prisma.listingFeeRule.findFirst({ where: { sellerId: null, categoryId: null } });
  if (!platformFee) {
    await prisma.listingFeeRule.create({
      data: {
        id: ulid(),
        sellerId: null,
        categoryId: null,
        amountMinor: 0,
        currency: 'USD',
        enabled: true,
        note: 'Platform default — free to list',
      },
    });
  }
  const electronics = await prisma.category.findUnique({ where: { slug: 'electronics' } });
  if (electronics) {
    const exists = await prisma.listingFeeRule.findFirst({ where: { categoryId: electronics.id, sellerId: null } });
    if (!exists) {
      await prisma.listingFeeRule.create({
        data: {
          id: ulid(),
          sellerId: null,
          categoryId: electronics.id,
          amountMinor: 99,
          currency: 'USD',
          enabled: true,
          note: 'Electronics category fee',
        },
      });
    }
  }

  // a default shipping rule for the seller
  const ruleExists = await prisma.shippingRule.findFirst({ where: { sellerId: seller.id } });
  if (!ruleExists) {
    await prisma.shippingRule.create({
      data: {
        id: ulid(),
        sellerId: seller.id,
        name: 'Default — worldwide standard',
        priority: 100,
        minWeightGrams: 0,
        maxWeightGrams: null,
        destinationCountries: [],
        flatRateMinor: 499,
        freeAboveMinor: 5000,
        carrierCodeWhitelist: ['mock', 'fedex', 'ups', 'dhl', 'canadapost'],
        enabled: true,
        currency: 'USD',
      },
    });
  }

  // products
  for (const p of PRODUCTS) {
    const category = await prisma.category.findUnique({ where: { slug: p.categorySlug } });
    if (!category) continue;
    const existing = await prisma.product.findUnique({ where: { slug: p.slug } });
    if (existing) continue;

    await prisma.product.create({
      data: {
        id: ulid(),
        sellerId: seller.id,
        categoryId: category.id,
        slug: p.slug,
        title: p.title,
        description: p.description,
        currency: 'USD',
        basePriceMinor: p.basePriceMinor,
        status: 'ACTIVE',
        variants: {
          create: p.variants.map((v, idx) => ({
            id: ulid(),
            sku: v.sku,
            name: v.name,
            priceMinor: v.priceMinor,
            inventoryQty: v.inventoryQty,
            weightGrams: v.weightGrams,
            attributes: { position: idx + 1 } as object,
          })),
        },
        media: {
          create: p.media.map((url, idx) => ({
            id: ulid(),
            url,
            alt: p.title,
            position: idx,
          })),
        },
      },
    });
  }

  // sample buyer address
  const buyerId = userMap.get('buyer@onsective.com')!;
  const addrCount = await prisma.address.count({ where: { userId: buyerId } });
  if (addrCount === 0) {
    await prisma.address.create({
      data: {
        id: ulid(),
        userId: buyerId,
        fullName: 'Aarav Mehta',
        line1: '221B Baker Street',
        city: 'Mumbai',
        region: 'MH',
        postalCode: '400001',
        country: 'IN',
        phone: '+91-9000000000',
        isDefault: true,
      },
    });
  }

  console.log('✓ Seed complete. Login as:');
  console.log('   admin   → admin@onsective.com    / OnsectiveAdmin1!');
  console.log('   seller  → seller@onsective.com   / OnsectiveSell1!');
  console.log('   buyer   → buyer@onsective.com    / OnsectiveBuy1!');
  console.log('   shipper → shipper@onsective.com  / OnsectiveShip1!');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
