import { ForbiddenException, Injectable, PreconditionFailedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AgeConsentService } from './age-consent.service';
import { SellerDocsService } from './seller-docs.service';

export interface GateLineInput {
  productId: string;
  qty: number;
}

export interface GateContext {
  userId: string;
  shippingCountry: string; // ISO-3166-1 alpha-2
}

@Injectable()
export class ComplianceGateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly age: AgeConsentService,
    private readonly sellerDocs: SellerDocsService,
  ) {}

  /**
   * Run all compliance checks for an in-flight order. Throws an HTTP-friendly exception
   * on the first violation so the buyer gets a precise reason.
   */
  async gateOrder(ctx: GateContext, lines: GateLineInput[]): Promise<void> {
    if (lines.length === 0) return;
    const country = ctx.shippingCountry.toUpperCase();
    const products = await this.prisma.product.findMany({
      where: { id: { in: lines.map((l) => l.productId) } },
      include: { category: { include: { compliance: true } } },
    });

    for (const product of products) {
      const rule = product.category.compliance;

      // Country gate (per-category rule).
      if (rule) {
        if (rule.allowedCountries.length > 0 && !rule.allowedCountries.includes(country)) {
          throw new ForbiddenException(
            `"${product.title}" cannot be shipped to ${country}.`,
          );
        }
        if (rule.blockedCountries.includes(country)) {
          throw new ForbiddenException(
            `"${product.title}" cannot be shipped to ${country}.`,
          );
        }
      }

      // Age gate (per-product or per-category mirror).
      const minAge = product.minBuyerAge ?? rule?.minBuyerAge ?? 0;
      if (product.requiresAgeCheck || minAge > 0) {
        const ok = await this.age.hasValidConsent({ userId: ctx.userId, minAge });
        if (!ok) {
          throw new PreconditionFailedException(
            `Age verification required for "${product.title}" (minimum ${minAge}). Please verify your age first.`,
          );
        }
      }

      // Seller doc gate (per-category rule).
      if (rule?.requiresSellerDoc) {
        const docOk = await this.sellerDocs.sellerHasApprovedDocFor(
          product.sellerId,
          product.categoryId,
        );
        if (!docOk) {
          throw new ForbiddenException(
            `Seller is not currently authorized to sell "${product.title}" — required compliance documents are missing or expired.`,
          );
        }
      }
    }
  }

  /** Lightweight gate for cart-add — same checks minus shipping country (no address yet). */
  async gateCartAdd(userId: string, productId: string, sessionId?: string | null): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { category: { include: { compliance: true } } },
    });
    if (!product) return;
    const rule = product.category.compliance;
    const minAge = product.minBuyerAge ?? rule?.minBuyerAge ?? 0;
    if (product.requiresAgeCheck || minAge > 0) {
      const ok = await this.age.hasValidConsent({ userId, sessionId, minAge });
      if (!ok) {
        throw new PreconditionFailedException(
          `Age verification required for "${product.title}" (minimum ${minAge}). Please verify your age first.`,
        );
      }
    }
    if (rule?.requiresSellerDoc) {
      const docOk = await this.sellerDocs.sellerHasApprovedDocFor(
        product.sellerId,
        product.categoryId,
      );
      if (!docOk) {
        throw new ForbiddenException(
          `Seller is not currently authorized to sell "${product.title}".`,
        );
      }
    }
  }
}
