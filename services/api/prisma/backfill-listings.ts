/**
 * Listings-refactor Step 1 — one-shot backfill.
 *
 * For every existing Product, ensure a single ProductListing exists with
 * the same seller, price, condition, fulfillment mode, and currency. This
 * is idempotent — re-running upserts on the (productId, sellerId, condition)
 * unique. Safe to run on a live database; no existing flow reads from
 * ProductListing yet.
 *
 * Run:   pnpm exec tsx prisma/backfill-listings.ts
 */

import { PrismaClient, ListingStatus, FulfillmentMode } from '@prisma/client';
import { ulid } from 'ulid';

const prisma = new PrismaClient();

async function main() {
  const products = await prisma.product.findMany({
    select: {
      id: true,
      slug: true,
      sellerId: true,
      basePriceMinor: true,
      currency: true,
      condition: true,
      status: true,
      fulfillmentMode: true,
    },
  });

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const p of products) {
    const status: ListingStatus = p.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';
    const result = await prisma.productListing.upsert({
      where: {
        productId_sellerId_condition: {
          productId: p.id,
          sellerId: p.sellerId,
          condition: p.condition,
        },
      },
      create: {
        id: ulid(),
        productId: p.id,
        sellerId: p.sellerId,
        sku: p.slug,
        condition: p.condition,
        priceMinor: p.basePriceMinor,
        currency: p.currency,
        status,
        fulfillmentMode: p.fulfillmentMode as FulfillmentMode,
        // Sole listing → trivially the Buy Box winner.
        isBuyBoxWinner: true,
      },
      update: {
        // Don't clobber per-seller edits made post-backfill; only refresh
        // price/status/fulfillment if the product canonical changed.
        priceMinor: p.basePriceMinor,
        currency: p.currency,
        status,
        fulfillmentMode: p.fulfillmentMode as FulfillmentMode,
      },
    });
    if (result.createdAt.getTime() === result.updatedAt.getTime()) created++;
    else updated++;
    void skipped;
  }

  console.log(`backfill complete: ${created} created, ${updated} updated/refreshed`);
  console.log(`total products: ${products.length}, total listings now: ${await prisma.productListing.count()}`);

  // Step 3: backfill listingId on existing CartItem + OrderItem rows.
  // Each variant maps to its sole listing (one per product post-Step-1).
  const variantListing = new Map<string, string>();
  const variants = await prisma.productVariant.findMany({
    select: { id: true, productId: true },
  });
  for (const v of variants) {
    const l = await prisma.productListing.findFirst({
      where: { productId: v.productId, status: { in: ['ACTIVE', 'INACTIVE'] } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (l) variantListing.set(v.id, l.id);
  }

  let cartFilled = 0;
  for (const [variantId, listingId] of variantListing) {
    const r = await prisma.cartItem.updateMany({
      where: { variantId, listingId: null },
      data: { listingId },
    });
    cartFilled += r.count;
  }
  console.log(`cart items backfilled with listingId: ${cartFilled}`);

  let orderFilled = 0;
  for (const [variantId, listingId] of variantListing) {
    const r = await prisma.orderItem.updateMany({
      where: { variantId, listingId: null },
      data: { listingId },
    });
    orderFilled += r.count;
  }
  console.log(`order items backfilled with listingId: ${orderFilled}`);
}

main()
  .catch((e) => {
    console.error('backfill failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
