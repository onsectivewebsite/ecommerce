/**
 * Tiny template engine — `{{var}}` substitution, no logic, no escaping
 * (text only). HTML templates would need escaping; we ship text-first.
 *
 * Templates are intentionally inline (not loaded from disk) so the
 * deployable artifact is a single bundle without a template directory
 * to manage. We can swap to disk-backed templates if marketing wants
 * non-engineer edits.
 */

export interface EmailTemplate {
  subject: string;
  text: string;
  html?: string;
}

const TEMPLATES: Record<string, EmailTemplate> = {
  order_paid: {
    subject: 'Your order #{{orderShort}} is confirmed',
    text:
`Hi {{firstName}},

Thanks for your order on Onsective. We've notified the seller and you'll get tracking soon.

Order: #{{orderShort}}
Total: {{total}} {{currency}}

You can view your order at {{orderUrl}}.

— The Onsective team`,
  },
  shipment_picked_up: {
    subject: 'Your order is on the way',
    text:
`Hi {{firstName}},

{{label}}

Track it: {{trackUrl}}

— The Onsective team`,
  },
  shipment_in_transit: {
    subject: 'In transit',
    text: `Hi {{firstName}},\n\n{{label}}\n\nTrack: {{trackUrl}}\n\n— The Onsective team`,
  },
  shipment_out_for_delivery: {
    subject: 'Out for delivery today',
    text: `Hi {{firstName}},\n\n{{label}}\n\nTrack: {{trackUrl}}\n\n— The Onsective team`,
  },
  shipment_delivered: {
    subject: 'Delivered',
    text:
`Hi {{firstName}},

Your order #{{orderShort}} has been delivered.

If you have any issues, you can reply to your order thread or start a return within 30 days.

— The Onsective team`,
  },
  shipment_exception: {
    subject: 'Delivery exception on your order',
    text:
`Hi {{firstName}},

There was a delivery exception on your order #{{orderShort}}.

{{label}}

You can message the seller or contact support: {{orderUrl}}

— The Onsective team`,
  },
  payout_paid: {
    subject: 'Payout sent',
    text:
`Hi {{firstName}},

A payout of {{total}} {{currency}} has been sent to your bank.

Reference: {{payoutId}}

— The Onsective team`,
  },
  return_requested: {
    subject: 'New return request',
    text:
`A buyer requested a return for order #{{orderShort}}.

Reason: {{reason}}

Review and respond from your seller dashboard.

— The Onsective team`,
  },
  return_approved: {
    subject: 'Return approved',
    text:
`Hi {{firstName}},

Your return has been approved. Print the return label and drop the package at the carrier.

Manage return: {{returnUrl}}

— The Onsective team`,
  },
  return_rejected: {
    subject: 'Return rejected',
    text:
`Hi {{firstName}},

The seller declined your return. You can appeal via support if you disagree.

{{sellerNote}}

— The Onsective team`,
  },
  return_refunded: {
    subject: 'Refund issued',
    text:
`Hi {{firstName}},

Your refund for order #{{orderShort}} has been processed. Funds typically appear in 3–5 business days.

— The Onsective team`,
  },
  review_posted: {
    subject: 'New review on your product',
    text:
`A new {{rating}}★ review was posted on "{{productTitle}}".

— The Onsective team`,
  },
  dispute_opened: {
    subject: 'Dispute opened',
    text:
`A dispute has been opened. Support will be in touch — please respond in your dashboard.

— The Onsective team`,
  },
  dispute_resolved: {
    subject: 'Dispute resolved',
    text: `Dispute resolved: {{outcome}}.\n\n— The Onsective team`,
  },
  message_new: {
    subject: 'New message on your order',
    text:
`You have a new message on order #{{orderShort}}.

{{preview}}

View thread: {{threadUrl}}

— The Onsective team`,
  },
  wishlist_price_drop: {
    subject: 'Price drop on your wishlist',
    text:
`"{{productTitle}}" is now {{dropPct}}% off. Was {{wasPrice}} → now {{nowPrice}}.

View: {{productUrl}}

— The Onsective team`,
  },
  wishlist_back_in_stock: {
    subject: 'Back in stock',
    text: `"{{productTitle}}" is available again.\n\n{{productUrl}}\n\n— The Onsective team`,
  },
  cart_recovery_24h: {
    subject: 'Forget something?',
    text: `Hi {{firstName}},\n\nYou left items in your cart. Pick up where you left off: {{cartUrl}}\n\n— The Onsective team`,
  },
  cart_recovery_72h: {
    subject: 'Still thinking it over?',
    text:
`Hi {{firstName}},

Your cart is still waiting. {{incentive}}

{{cartUrl}}

— The Onsective team`,
  },
  inventory_low_stock: {
    subject: 'Low stock projected on {{variantName}}',
    text:
`At your current sales rate ({{velocity}}/day) you'll be out of "{{variantName}}" in about {{daysUntilEmpty}} days.

Restock from your dashboard.

— The Onsective team`,
  },
  seller_health_low: {
    subject: 'Seller account suspended',
    text:
`Your seller account has been suspended because your health score fell below the operating threshold.

Reason: {{reason}}

Please contact support to appeal.

— The Onsective team`,
  },
  security_sign_in_alert: {
    subject: 'New sign-in to your Onsective account',
    text:
`We noticed a sign-in to your account.

{{reason}}
Country: {{country}}

If this was you, no action is needed. If it wasn't, please change your password immediately and reach out to support.

— The Onsective team`,
  },
  security_step_up_code: {
    subject: 'Your Onsective verification code',
    text:
`Use the code below to confirm the sensitive action you just started. It expires in 10 minutes.

   {{code}}

If you didn't request this, ignore the email — no further action will be taken.

— The Onsective team`,
  },
  plus_renewed: {
    subject: 'Your Onsective Plus membership renewed',
    text:
`Hi {{firstName}},

Your {{plan}} Onsective Plus membership just renewed for {{priceFormatted}}. Your next renewal is on {{nextRenewal}}.

Manage your membership: {{membershipUrl}}

— The Onsective team`,
  },
  plus_payment_failed: {
    subject: 'Action needed — your Plus payment didn\'t go through',
    text:
`Hi {{firstName}},

We weren't able to charge your card for your Onsective Plus renewal. Plus benefits are paused until the payment goes through.

Update your payment method: {{paymentMethodsUrl}}

— The Onsective team`,
  },
  plus_expiring_soon: {
    subject: 'Your Onsective Plus ends in {{daysUntilExpiry}} days',
    text:
`Hi {{firstName}},

Heads up — your Onsective Plus membership ends on {{expiresOn}}. Re-enable auto-renew any time to keep free shipping, extended warranty, points multipliers, and outlet early access.

Manage your membership: {{membershipUrl}}

— The Onsective team`,
  },
  plus_expired: {
    subject: 'Your Onsective Plus membership has ended',
    text:
`Hi {{firstName}},

Your Onsective Plus membership has ended. You can rejoin any time — your saved cards and points balance are still here when you come back.

Rejoin: {{membershipUrl}}

— The Onsective team`,
  },
  password_reset: {
    subject: 'Reset your Onsective password',
    text:
`Hi {{firstName}},

We received a request to reset your Onsective password. Click below to choose a new one — the link expires in {{ttlHours}} hour(s).

{{resetUrl}}

If you didn't ask for this, you can safely ignore this email. Your password won't change until you open the link and set a new one.

— The Onsective team`,
  },
  account_recovery_requested: {
    subject: 'Confirm your Onsective account recovery',
    text:
`Hi {{firstName}},

Someone started a two-factor recovery for your Onsective account. If this was you, confirm to begin the {{waitHours}}-hour security waiting period:

Continue recovery: {{confirmUrl}}

If this WASN'T you, cancel it immediately — your account is unchanged and no further action is needed:

Cancel: {{cancelUrl}}

— The Onsective team`,
  },
  account_recovery_confirmed: {
    subject: 'Account recovery in progress',
    text:
`Hi {{firstName}},

Your two-factor recovery is now in progress. For your security, it completes on {{eligibleAt}}. After that you'll be able to remove two-factor and sign back in.

If you didn't request this, cancel right now to keep your account locked down:

Cancel: {{cancelUrl}}

— The Onsective team`,
  },
  account_recovery_reminder: {
    subject: 'Reminder: account recovery still pending',
    text:
`Hi {{firstName}},

This is a reminder that a two-factor recovery for your Onsective account is still in progress. It completes on {{eligibleAt}}.

If you did NOT request this, cancel it now — otherwise two-factor will be removed:

Cancel: {{cancelUrl}}

— The Onsective team`,
  },
  account_recovery_ready: {
    subject: 'You can now complete your account recovery',
    text:
`Hi {{firstName}},

The security waiting period has passed. You can now finish recovery and remove two-factor from your account:

Complete recovery: {{completeUrl}}

Still not you? You can cancel right up until recovery is completed:

Cancel: {{cancelUrl}}

— The Onsective team`,
  },
  account_recovery_completed: {
    subject: 'Two-factor was removed from your account',
    text:
`Hi {{firstName}},

Two-factor authentication has been removed from your Onsective account through account recovery. You can now sign in with your password and re-enroll two-factor or a passkey from your security settings.

If this WASN'T you, contact support immediately — your account may be compromised.

— The Onsective team`,
  },
  account_recovery_cancelled: {
    subject: 'Account recovery cancelled',
    text:
`Hi {{firstName}},

The two-factor recovery on your Onsective account has been cancelled. Nothing changed — your two-factor protection is still in place.

— The Onsective team`,
  },
  gift_card_received: {
    subject: '{{senderName}} sent you an Onsective gift card',
    text:
`Hi{{recipientGreeting}},

{{senderName}} has sent you an Onsective gift card worth {{amount}} {{currency}}.

{{messageBlock}}Your gift card code:

   {{code}}

Redeem it here — the balance is added to your Onsective wallet and never expires:

{{redeemUrl}}

— The Onsective team`,
  },
  gift_card_purchase_receipt: {
    subject: 'Your Onsective gift card purchase',
    text:
`Hi {{firstName}},

Thanks for your purchase. Here are the details:

Amount:     {{amount}} {{currency}}
Recipient:  {{recipientEmail}}
Delivery:   {{deliveryLine}}

We'll let the recipient know it's on the way. You can see the status of cards you've sent any time at {{giftCardsUrl}}.

— The Onsective team`,
  },
};

export function renderTemplate(category: string, vars: Record<string, string | number> = {}): EmailTemplate | null {
  const t = TEMPLATES[category];
  if (!t) return null;
  return {
    subject: substitute(t.subject, vars),
    text: substitute(t.text, vars),
    html: t.html ? substitute(t.html, vars) : undefined,
  };
}

function substitute(input: string, vars: Record<string, string | number>): string {
  return input.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

export type EmailKind = 'transactional' | 'marketing';

/**
 * Phase 32: marketing kinds are gated on cookie/marketing consent at send-time
 * and get an auto-appended unsubscribe footer. Anything not in this set is
 * treated as transactional (order/shipment/billing/security/etc.) and is
 * never blocked by marketing preferences.
 */
const MARKETING_CATEGORIES = new Set<string>([
  'wishlist_price_drop',
  'wishlist_back_in_stock',
  'cart_recovery_24h',
  'cart_recovery_72h',
]);

export function templateKind(category: string): EmailKind {
  return MARKETING_CATEGORIES.has(category) ? 'marketing' : 'transactional';
}
