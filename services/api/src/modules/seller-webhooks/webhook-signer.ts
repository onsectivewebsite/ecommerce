import { createHmac, randomBytes } from 'crypto';

export function generateSecret(): string {
  // 32 random bytes → base64url string sellers paste into their verification code.
  return `whsec_${randomBytes(24).toString('base64url')}`;
}

export function sign(secret: string, body: string, timestamp: number): string {
  // Stripe-style signed payload: `<ts>.<body>` → HMAC-SHA256 → hex.
  const h = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${h}`;
}
