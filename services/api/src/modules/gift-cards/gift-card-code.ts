import { randomBytes } from 'crypto';

/**
 * Gift-card code: ONS-XXXX-XXXX-XXXX. Crockford-ish alphabet — no 0/O, no
 * 1/I/L — so a code read off a screen or email transcribes cleanly. 12
 * random chars over a 31-symbol alphabet ≈ 59 bits, ample against guessing
 * (and redemption is rate-limited + auth-gated on top).
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const GROUPS = 3;
const GROUP_LEN = 4;

export function generateGiftCardCode(): string {
  const total = GROUPS * GROUP_LEN;
  const bytes = randomBytes(total);
  const chars: string[] = [];
  for (let i = 0; i < total; i++) chars.push(ALPHABET[bytes[i] % ALPHABET.length]);
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    groups.push(chars.slice(g * GROUP_LEN, (g + 1) * GROUP_LEN).join(''));
  }
  return `ONS-${groups.join('-')}`;
}

/** Normalize user input: uppercase, keep only alphabet chars, re-group. */
export function normalizeGiftCardCode(input: string): string {
  const kept = input
    .toUpperCase()
    .split('')
    .filter((c) => ALPHABET.includes(c))
    .join('');
  if (kept.length !== GROUPS * GROUP_LEN) return input.trim().toUpperCase();
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    groups.push(kept.slice(g * GROUP_LEN, (g + 1) * GROUP_LEN));
  }
  return `ONS-${groups.join('-')}`;
}
