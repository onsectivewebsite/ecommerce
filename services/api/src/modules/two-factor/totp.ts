import { createHmac, randomBytes } from 'crypto';

/**
 * RFC 6238 TOTP with HMAC-SHA1, 6 digits, 30s step — the de-facto authenticator
 * app standard (Google Authenticator, 1Password, Authy, Microsoft Authenticator
 * all generate identical codes from a given secret + step).
 *
 * We keep this hand-rolled (rather than pulling otplib) because the algorithm
 * is small, well-specified, and we control the verification window + replay
 * guard precisely. No third-party dep can be quietly upgraded to weaken these.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
const DIGIT_MOD = 10 ** DIGITS;

export function generateSecret(): Buffer {
  // 20 bytes = 160 bits, the RFC 4226 recommendation for HMAC-SHA1 TOTP.
  return randomBytes(20);
}

/** Compute the current TOTP step counter for a given epoch-ms. */
export function stepAt(epochMs: number): number {
  return Math.floor(epochMs / 1000 / STEP_SECONDS);
}

/** Generate the 6-digit TOTP code for a secret at a given step counter. */
export function totpAtStep(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  // High 32 bits stay zero — JS bitwise is 32-bit, and step never gets near 2^32.
  counter.writeUInt32BE(Math.floor(step / 0x100000000), 0);
  counter.writeUInt32BE(step >>> 0, 4);
  const hmac = createHmac('sha1', secret).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % DIGIT_MOD).toString().padStart(DIGITS, '0');
}

/**
 * Verify a submitted code within ±windowSteps of the current step.
 * Returns the matching step counter, or null if no match.
 * Constant-time compare against each candidate to avoid timing leaks.
 */
export function verifyTotp(
  secret: Buffer,
  submitted: string,
  opts: { now?: number; windowSteps?: number; lastUsedStep?: number } = {},
): number | null {
  const cleaned = submitted.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleaned)) return null;
  const now = opts.now ?? Date.now();
  const window = opts.windowSteps ?? 1;
  const center = stepAt(now);
  for (let drift = -window; drift <= window; drift++) {
    const step = center + drift;
    if (opts.lastUsedStep !== undefined && step <= opts.lastUsedStep) continue;
    const candidate = totpAtStep(secret, step);
    if (timingSafeEqualStr(candidate, cleaned)) return step;
  }
  return null;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ────────────────────────────── Base32 (RFC 4648, no padding) ──────────────────────────────

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function toBase32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Build the otpauth URL authenticator apps render as a QR code. */
export function buildOtpauthUrl(opts: {
  issuer: string;
  accountName: string;
  secret: Buffer;
}): string {
  const label = `${opts.issuer}:${opts.accountName}`;
  const params = new URLSearchParams({
    secret: toBase32(opts.secret),
    issuer: opts.issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}
